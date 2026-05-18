const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// ─────────────────────────────────────────────
//  IN-MEMORY DATABASE  (swap with your DB/JSON)
// ─────────────────────────────────────────────
const db = new Map(); // userId → accountData

function getAccount(userId) {
  if (!db.has(userId)) {
    db.set(userId, {
      balance: 500,
      bank: 0,
      creditScore: 650,
      creditCard: null,         // null or { limit, balance, debt }
      lastDaily: null,
      lastWork: null,
      lastRob: null,
      loanDebt: 0,
      transactions: [],
    });
  }
  return db.get(userId);
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
const fmt = (n) => `💵 **${Number(n).toLocaleString()}**`;
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const cooldownMs = (ms, last) => last ? Math.max(0, ms - (Date.now() - last)) : 0;
const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
};

function creditRating(score) {
  if (score >= 800) return { label: 'Exceptional ✨', color: 0x00ff88 };
  if (score >= 740) return { label: 'Very Good 🟢', color: 0x44dd66 };
  if (score >= 670) return { label: 'Good 🟡', color: 0xffdd00 };
  if (score >= 580) return { label: 'Fair 🟠', color: 0xff8800 };
  return { label: 'Poor 🔴', color: 0xff2244 };
}

function addTransaction(acc, type, amount, note) {
  acc.transactions.unshift({ type, amount, note, at: new Date().toISOString() });
  if (acc.transactions.length > 20) acc.transactions.pop();
}

// ─────────────────────────────────────────────
//  COMMAND DEFINITIONS
// ─────────────────────────────────────────────
module.exports = {
  // Register all slash commands
  data: [
    new SlashCommandBuilder().setName('balance').setDescription('Check your wallet, bank, and credit info'),

    new SlashCommandBuilder().setName('deposit')
      .setDescription('Deposit coins into your bank')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount or type "all"').setRequired(true).setMinValue(1)),

    new SlashCommandBuilder().setName('withdraw')
      .setDescription('Withdraw coins from your bank')
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),

    new SlashCommandBuilder().setName('transfer')
      .setDescription('Send coins to another user')
      .addUserOption(o => o.setName('user').setDescription('Recipient').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1)),

    new SlashCommandBuilder().setName('daily').setDescription('Claim your daily reward'),

    new SlashCommandBuilder().setName('work').setDescription('Work to earn coins (1h cooldown)'),

    new SlashCommandBuilder().setName('rob')
      .setDescription('Attempt to rob another user')
      .addUserOption(o => o.setName('target').setDescription('Who to rob').setRequired(true)),

    new SlashCommandBuilder().setName('creditscore').setDescription('Check your credit score'),

    new SlashCommandBuilder().setName('creditcard')
      .setDescription('Apply for or manage your credit card')
      .addStringOption(o => o.setName('action')
        .setDescription('apply | pay | info')
        .setRequired(true)
        .addChoices(
          { name: 'Apply', value: 'apply' },
          { name: 'Pay debt', value: 'pay' },
          { name: 'Info', value: 'info' },
        )),

    new SlashCommandBuilder().setName('loan')
      .setDescription('Take or repay a loan based on your credit score')
      .addStringOption(o => o.setName('action').setDescription('take | repay').setRequired(true)
        .addChoices({ name: 'Take loan', value: 'take' }, { name: 'Repay loan', value: 'repay' }))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setMinValue(1)),

    new SlashCommandBuilder().setName('transactions').setDescription('View your recent transaction history'),
  ],

  // ─────────────────────────────────────────────
  //  HANDLER  —  route each command
  // ─────────────────────────────────────────────
  async execute(interaction) {
    const { commandName, user } = interaction;
    const acc = getAccount(user.id);

    // ── /balance ──────────────────────────────
    if (commandName === 'balance') {
      const rating = creditRating(acc.creditScore);
      const embed = new EmbedBuilder()
        .setTitle(`🏦 ${user.username}'s Account`)
        .setColor(rating.color)
        .setThumbnail(user.displayAvatarURL())
        .addFields(
          { name: '👛 Wallet', value: `$${acc.balance.toLocaleString()}`, inline: true },
          { name: '🏦 Bank', value: `$${acc.bank.toLocaleString()}`, inline: true },
          { name: '💳 Net Worth', value: `$${(acc.balance + acc.bank).toLocaleString()}`, inline: true },
          { name: '📊 Credit Score', value: `${acc.creditScore} — ${rating.label}`, inline: true },
          { name: '💳 Credit Card', value: acc.creditCard ? `Limit: $${acc.creditCard.limit} | Debt: $${acc.creditCard.debt}` : 'None', inline: true },
          { name: '💸 Loan Debt', value: `$${acc.loanDebt.toLocaleString()}`, inline: true },
        )
        .setFooter({ text: 'Use /deposit to keep coins safe!' })
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    // ── /deposit ──────────────────────────────
    if (commandName === 'deposit') {
      const amount = interaction.options.getInteger('amount');
      if (amount > acc.balance) return interaction.reply({ content: `❌ You only have **$${acc.balance}** in your wallet.`, ephemeral: true });
      acc.balance -= amount;
      acc.bank += amount;
      addTransaction(acc, 'deposit', amount, 'Bank deposit');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ccff).setDescription(`✅ Deposited **$${amount.toLocaleString()}** into your bank!\n🏦 Bank balance: **$${acc.bank.toLocaleString()}**`)] });
    }

    // ── /withdraw ─────────────────────────────
    if (commandName === 'withdraw') {
      const amount = interaction.options.getInteger('amount');
      if (amount > acc.bank) return interaction.reply({ content: `❌ Your bank only has **$${acc.bank}**.`, ephemeral: true });
      acc.bank -= amount;
      acc.balance += amount;
      addTransaction(acc, 'withdraw', amount, 'Bank withdrawal');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ccff).setDescription(`✅ Withdrew **$${amount.toLocaleString()}** from your bank!\n👛 Wallet: **$${acc.balance.toLocaleString()}**`)] });
    }

    // ── /transfer ─────────────────────────────
    if (commandName === 'transfer') {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      if (target.id === user.id) return interaction.reply({ content: '❌ You cannot transfer to yourself.', ephemeral: true });
      if (target.bot) return interaction.reply({ content: '❌ Cannot transfer to bots.', ephemeral: true });
      if (amount > acc.balance) return interaction.reply({ content: `❌ Not enough coins in your wallet.`, ephemeral: true });
      const targetAcc = getAccount(target.id);
      acc.balance -= amount;
      targetAcc.balance += amount;
      addTransaction(acc, 'transfer_out', amount, `Sent to ${target.username}`);
      addTransaction(targetAcc, 'transfer_in', amount, `Received from ${user.username}`);
      // Small credit score bump for responsible transactions
      acc.creditScore = clamp(acc.creditScore + 1, 300, 850);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ff88).setDescription(`✅ Transferred **$${amount.toLocaleString()}** to **${target.username}**!\n👛 Your wallet: **$${acc.balance.toLocaleString()}**`)] });
    }

    // ── /daily ────────────────────────────────
    if (commandName === 'daily') {
      const cd = cooldownMs(24 * 60 * 60 * 1000, acc.lastDaily);
      if (cd > 0) return interaction.reply({ content: `⏳ Daily resets in **${fmtTime(cd)}**.`, ephemeral: true });
      const reward = Math.floor(Math.random() * 300) + 200; // 200–500
      acc.balance += reward;
      acc.lastDaily = Date.now();
      acc.creditScore = clamp(acc.creditScore + 2, 300, 850);
      addTransaction(acc, 'daily', reward, 'Daily reward');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xffdd00).setTitle('🎁 Daily Reward!').setDescription(`You claimed **$${reward.toLocaleString()}**!\n+2 Credit Score 📈\nCome back in 24 hours!`)] });
    }

    // ── /work ─────────────────────────────────
    if (commandName === 'work') {
      const cd = cooldownMs(60 * 60 * 1000, acc.lastWork);
      if (cd > 0) return interaction.reply({ content: `⏳ You need to rest. Come back in **${fmtTime(cd)}**.`, ephemeral: true });
      const jobs = ['flipped burgers', 'drove a cab', 'coded an app', 'mowed lawns', 'delivered packages', 'wrote articles', 'tutored students'];
      const job = jobs[Math.floor(Math.random() * jobs.length)];
      const earned = Math.floor(Math.random() * 150) + 50; // 50–200
      acc.balance += earned;
      acc.lastWork = Date.now();
      acc.creditScore = clamp(acc.creditScore + 1, 300, 850);
      addTransaction(acc, 'work', earned, `Worked: ${job}`);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x88aaff).setTitle('💼 Work Complete!').setDescription(`You ${job} and earned **$${earned.toLocaleString()}**!\n+1 Credit Score 📈`)] });
    }

    // ── /rob ──────────────────────────────────
    if (commandName === 'rob') {
      const target = interaction.options.getUser('target');
      if (target.id === user.id) return interaction.reply({ content: '❌ Cannot rob yourself.', ephemeral: true });
      if (target.bot) return interaction.reply({ content: '❌ Bots have no money.', ephemeral: true });

      const cd = cooldownMs(30 * 60 * 1000, acc.lastRob);
      if (cd > 0) return interaction.reply({ content: `⏳ You're laying low. Try again in **${fmtTime(cd)}**.`, ephemeral: true });

      const targetAcc = getAccount(target.id);
      acc.lastRob = Date.now();

      if (targetAcc.balance < 50) {
        acc.creditScore = clamp(acc.creditScore - 5, 300, 850);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff4444).setTitle('🚔 Robbery Failed!').setDescription(`**${target.username}** is broke! The cops caught you snooping.\n-5 Credit Score 📉`)] });
      }

      // 45% success rate, modified by relative credit scores
      const scoreDiff = (targetAcc.creditScore - acc.creditScore) / 850;
      const successChance = clamp(0.45 - scoreDiff * 0.1, 0.2, 0.7);
      const success = Math.random() < successChance;

      if (success) {
        const stolen = Math.floor(targetAcc.balance * (Math.random() * 0.3 + 0.1)); // 10–40%
        targetAcc.balance -= stolen;
        acc.balance += stolen;
        acc.creditScore = clamp(acc.creditScore - 10, 300, 850);
        targetAcc.creditScore = clamp(targetAcc.creditScore + 3, 300, 850);
        addTransaction(acc, 'rob_success', stolen, `Robbed ${target.username}`);
        addTransaction(targetAcc, 'robbed', stolen, `Robbed by ${user.username}`);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff8800).setTitle('💰 Successful Robbery!').setDescription(`You robbed **${target.username}** and got away with **$${stolen.toLocaleString()}**!\n-10 Credit Score 📉 (crime doesn't pay)`)] });
      } else {
        const fine = Math.floor(acc.balance * 0.15);
        acc.balance -= fine;
        targetAcc.balance += fine;
        acc.creditScore = clamp(acc.creditScore - 20, 300, 850);
        addTransaction(acc, 'rob_fail', fine, `Failed rob on ${target.username}, fined`);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xff2244).setTitle('🚔 Caught Red-Handed!').setDescription(`You failed to rob **${target.username}**!\nYou were fined **$${fine.toLocaleString()}** and paid it to the victim.\n-20 Credit Score 📉`)] });
      }
    }

    // ── /creditscore ──────────────────────────
    if (commandName === 'creditscore') {
      const rating = creditRating(acc.creditScore);
      const bar = buildScoreBar(acc.creditScore);
      const embed = new EmbedBuilder()
        .setTitle('📊 Credit Report')
        .setColor(rating.color)
        .setDescription(`**${user.username}'s Credit Score**`)
        .addFields(
          { name: 'Score', value: `**${acc.creditScore}** / 850`, inline: true },
          { name: 'Rating', value: rating.label, inline: true },
          { name: 'Progress', value: bar, inline: false },
          { name: 'How to improve', value: '• Use `/work` and `/daily` regularly\n• Repay loans and credit card debt\n• Avoid failed robberies\n• Transfer money to others', inline: false },
        )
        .setFooter({ text: 'Higher score = better loan rates & credit card limits' });
      return interaction.reply({ embeds: [embed] });
    }

    // ── /creditcard ───────────────────────────
    if (commandName === 'creditcard') {
      const action = interaction.options.getString('action');

      if (action === 'apply') {
        if (acc.creditCard) return interaction.reply({ content: '❌ You already have a credit card. Use `/creditcard info`.', ephemeral: true });
        if (acc.creditScore < 580) return interaction.reply({ content: `❌ Your credit score (**${acc.creditScore}**) is too low. You need at least **580**.`, ephemeral: true });

        // Limit based on credit score
        const limit = Math.floor((acc.creditScore / 850) * 5000) + 500;
        acc.creditCard = { limit, debt: 0, totalSpent: 0 };
        acc.creditScore = clamp(acc.creditScore + 5, 300, 850);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('💳 Credit Card Approved!').setDescription(`Congratulations! You've been approved for a credit card.\n\n💳 **Credit Limit:** $${limit.toLocaleString()}\n📈 +5 Credit Score\n\nYou can spend beyond your wallet balance, but debt accrues 5% interest daily. Use \`/creditcard pay\` to repay.`)] });
      }

      if (action === 'info') {
        if (!acc.creditCard) return interaction.reply({ content: '❌ You don\'t have a credit card. Apply with `/creditcard apply`.', ephemeral: true });
        const { limit, debt } = acc.creditCard;
        const available = limit - debt;
        const utilization = ((debt / limit) * 100).toFixed(1);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x4488ff).setTitle('💳 Credit Card Info').addFields(
          { name: 'Credit Limit', value: `$${limit.toLocaleString()}`, inline: true },
          { name: 'Current Debt', value: `$${debt.toLocaleString()}`, inline: true },
          { name: 'Available Credit', value: `$${available.toLocaleString()}`, inline: true },
          { name: 'Utilization', value: `${utilization}%`, inline: true },
          { name: '⚠️ Note', value: 'Unpaid debt accrues **5% interest per day**. Pay off debt to improve your credit score.', inline: false },
        )] });
      }

      if (action === 'pay') {
        if (!acc.creditCard) return interaction.reply({ content: '❌ You don\'t have a credit card.', ephemeral: true });
        if (acc.creditCard.debt <= 0) return interaction.reply({ content: '✅ You have no credit card debt!', ephemeral: true });
        const paying = Math.min(acc.balance, acc.creditCard.debt);
        if (paying <= 0) return interaction.reply({ content: '❌ You have no money in your wallet to pay.', ephemeral: true });
        acc.balance -= paying;
        acc.creditCard.debt -= paying;
        acc.creditScore = clamp(acc.creditScore + Math.floor(paying / 100), 300, 850);
        addTransaction(acc, 'cc_payment', paying, 'Credit card payment');
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('💳 Credit Card Payment').setDescription(`Paid **$${paying.toLocaleString()}** toward your credit card debt.\n💳 Remaining debt: **$${acc.creditCard.debt.toLocaleString()}**\n📈 +${Math.floor(paying / 100)} Credit Score`)] });
      }
    }

    // ── /loan ─────────────────────────────────
    if (commandName === 'loan') {
      const action = interaction.options.getString('action');
      const amount = interaction.options.getInteger('amount');

      if (action === 'take') {
        if (!amount) return interaction.reply({ content: '❌ Specify an amount with `/loan take amount:<number>`.', ephemeral: true });
        if (acc.loanDebt > 0) return interaction.reply({ content: `❌ You must repay your existing loan of **$${acc.loanDebt.toLocaleString()}** first.`, ephemeral: true });
        if (acc.creditScore < 580) return interaction.reply({ content: `❌ Your credit score (**${acc.creditScore}**) is too low for a loan. Minimum: **580**.`, ephemeral: true });

        // Max loan based on credit score
        const maxLoan = Math.floor((acc.creditScore / 850) * 10000);
        if (amount > maxLoan) return interaction.reply({ content: `❌ Based on your credit score, you can borrow up to **$${maxLoan.toLocaleString()}**.`, ephemeral: true });

        // Interest rate based on credit score (3%–15%)
        const rate = Math.max(3, Math.floor((1 - acc.creditScore / 850) * 15));
        const repayAmount = Math.floor(amount * (1 + rate / 100));

        acc.balance += amount;
        acc.loanDebt = repayAmount;
        acc.creditScore = clamp(acc.creditScore - 5, 300, 850);
        addTransaction(acc, 'loan_taken', amount, `Loan at ${rate}% interest`);
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xffaa00).setTitle('💸 Loan Approved!').addFields(
          { name: 'Amount Received', value: `$${amount.toLocaleString()}`, inline: true },
          { name: 'Interest Rate', value: `${rate}%`, inline: true },
          { name: 'Total to Repay', value: `$${repayAmount.toLocaleString()}`, inline: true },
          { name: '⚠️ Warning', value: 'Use `/loan repay` to pay back. Defaulting hurts your credit score.', inline: false },
        )] });
      }

      if (action === 'repay') {
        if (acc.loanDebt <= 0) return interaction.reply({ content: '✅ You have no outstanding loans!', ephemeral: true });
        const paying = amount ? Math.min(amount, acc.loanDebt) : Math.min(acc.balance, acc.loanDebt);
        if (paying > acc.balance) return interaction.reply({ content: `❌ You only have **$${acc.balance.toLocaleString()}** in your wallet.`, ephemeral: true });
        acc.balance -= paying;
        acc.loanDebt -= paying;
        acc.creditScore = clamp(acc.creditScore + Math.floor(paying / 200) + 5, 300, 850);
        addTransaction(acc, 'loan_repay', paying, 'Loan repayment');
        const fullPaid = acc.loanDebt === 0;
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00ff88).setTitle('💸 Loan Repayment').setDescription(`Paid **$${paying.toLocaleString()}** toward your loan.\n${fullPaid ? '🎉 **Loan fully paid off!**' : `Remaining debt: **$${acc.loanDebt.toLocaleString()}**`}\n📈 +${Math.floor(paying / 200) + 5} Credit Score`)] });
      }
    }

    // ── /transactions ─────────────────────────
    if (commandName === 'transactions') {
      if (acc.transactions.length === 0) return interaction.reply({ content: '📭 No transactions yet.', ephemeral: true });
      const icons = { deposit: '⬆️', withdraw: '⬇️', transfer_out: '➡️', transfer_in: '⬅️', daily: '🎁', work: '💼', rob_success: '💰', robbed: '😢', rob_fail: '🚔', cc_payment: '💳', loan_taken: '💸', loan_repay: '✅' };
      const lines = acc.transactions.slice(0, 10).map(t => {
        const icon = icons[t.type] || '🔄';
        const sign = ['withdraw', 'transfer_out', 'rob_fail', 'robbed', 'cc_payment', 'loan_repay'].includes(t.type) ? '-' : '+';
        return `${icon} **${sign}$${t.amount.toLocaleString()}** — ${t.note}`;
      }).join('\n');
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x8888ff).setTitle('📋 Recent Transactions').setDescription(lines).setFooter({ text: 'Showing last 10 transactions' })] });
    }
  },
};

// ─────────────────────────────────────────────
//  CREDIT SCORE BAR
// ─────────────────────────────────────────────
function buildScoreBar(score) {
  const filled = Math.round((score / 850) * 20);
  const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
  return `\`[${bar}]\` ${score}/850`;
}

// ─────────────────────────────────────────────
//  DAILY INTEREST TICK  (call this on an interval)
//  e.g.: setInterval(applyDailyInterest, 24 * 60 * 60 * 1000);
// ─────────────────────────────────────────────
function applyDailyInterest() {
  for (const [, acc] of db) {
    if (acc.creditCard && acc.creditCard.debt > 0) {
      const interest = Math.ceil(acc.creditCard.debt * 0.05);
      acc.creditCard.debt += interest;
      acc.creditScore = clamp(acc.creditScore - 3, 300, 850);
    }
    if (acc.loanDebt > 0) {
      const interest = Math.ceil(acc.loanDebt * 0.02);
      acc.loanDebt += interest;
      acc.creditScore = clamp(acc.creditScore - 2, 300, 850);
    }
  }
}

module.exports.applyDailyInterest = applyDailyInterest;
