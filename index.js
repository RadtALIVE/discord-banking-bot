const { Client, GatewayIntentBits } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const banking = require('./banking');
const { initDB, applyDailyInterest } = require('./db');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST({ version: '10' }).setToken(TOKEN);

// Register slash commands
(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: banking.data.map(cmd => cmd.toJSON())
    });
    console.log('✅ Commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
})();

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await banking.execute(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ Something went wrong.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

client.once('ready', async () => {
  await initDB();
  console.log(`✅ Bot online as ${client.user.tag}`);
  client.user.setActivity('💰 /balance | /work | /rob');
  setInterval(applyDailyInterest, 24 * 60 * 60 * 1000);
});

client.login(TOKEN);
