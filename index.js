/ ─────────────────────────────────────────────
//  index.js  —  Bot entry point
//  npm install discord.js @discordjs/rest discord-api-types
// ─────────────────────────────────────────────
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const banking = require('./banking');

const TOKEN = 'MTUwNTk0MzcwNjE2MTY0NzcxOA.GBmqep.0LfVAoXQc4qROGSw_phi5t_TfxfiSfluIKGfYc
';       // ← replace
const CLIENT_ID = '1505943706161647718';       // ← replace

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ── Register slash commands ──────────────────
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🔄 Registering slash commands...');
    await rest.put(
      // For guild-only (instant): Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
      Routes.applicationCommands(CLIENT_ID),
      { body: banking.data.map(cmd => cmd.toJSON()) }
    );
    console.log('✅ Commands registered globally (may take up to 1 hour to appear).');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();

// ── Start daily interest tick ────────────────
const { applyDailyInterest } = require('./banking');
setInterval(applyDailyInterest, 24 * 60 * 60 * 1000); // every 24h

// ── Handle interactions ──────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await banking.execute(interaction);
  } catch (err) {
    console.error(`Error in /${interaction.commandName}:`, err);
    const msg = { content: '❌ An error occurred. Please try again.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity('💰 /balance | /work | /rob', { type: 0 });
});

client.login(TOKEN);
