const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 500,
      bank INTEGER DEFAULT 0,
      credit_score INTEGER DEFAULT 650,
      credit_card JSONB DEFAULT NULL,
      loan_debt INTEGER DEFAULT 0,
      last_daily BIGINT DEFAULT NULL,
      last_work BIGINT DEFAULT NULL,
      last_rob BIGINT DEFAULT NULL,
      transactions JSONB DEFAULT '[]'
    )
  `);
  console.log('✅ Database ready.');
}

async function getAccount(userId) {
  const res = await pool.query('SELECT * FROM accounts WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) {
    await pool.query('INSERT INTO accounts (user_id) VALUES ($1)', [userId]);
    return getAccount(userId);
  }
  const row = res.rows[0];
  return {
    balance: row.balance,
    bank: row.bank,
    creditScore: row.credit_score,
    creditCard: row.credit_card,
    loanDebt: row.loan_debt,
    lastDaily: row.last_daily,
    lastWork: row.last_work,
    lastRob: row.last_rob,
    transactions: row.transactions,
  };
}

async function saveAccount(userId, acc) {
  await pool.query(`
    INSERT INTO accounts (user_id, balance, bank, credit_score, credit_card, loan_debt, last_daily, last_work, last_rob, transactions)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (user_id) DO UPDATE SET
      balance=$2, bank=$3, credit_score=$4, credit_card=$5,
      loan_debt=$6, last_daily=$7, last_work=$8, last_rob=$9, transactions=$10
  `, [
    userId, acc.balance, acc.bank, acc.creditScore,
    JSON.stringify(acc.creditCard), acc.loanDebt,
    acc.lastDaily, acc.lastWork, acc.lastRob,
    JSON.stringify(acc.transactions),
  ]);
}

async function applyDailyInterest() {
  const res = await pool.query('SELECT user_id, credit_card, loan_debt, credit_score FROM accounts');
  for (const row of res.rows) {
    let { credit_card, loan_debt, credit_score } = row;
    let changed = false;
    if (credit_card && credit_card.debt > 0) {
      credit_card.debt += Math.ceil(credit_card.debt * 0.05);
      credit_score = Math.max(300, credit_score - 3);
      changed = true;
    }
    if (loan_debt > 0) {
      loan_debt += Math.ceil(loan_debt * 0.02);
      credit_score = Math.max(300, credit_score - 2);
      changed = true;
    }
    if (changed) {
      await pool.query(
        'UPDATE accounts SET credit_card=$1, loan_debt=$2, credit_score=$3 WHERE user_id=$4',
        [JSON.stringify(credit_card), loan_debt, credit_score, row.user_id]
      );
    }
  }
}

module.exports = { pool, initDB, getAccount, saveAccount, applyDailyInterest };
