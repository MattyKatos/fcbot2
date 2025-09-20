require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, ActivityType, REST, Routes, InteractionType, PermissionsBitField } = require('discord.js');
const { getPool } = require('./db');
const { buildFcPanel } = require('./ui/fc');
const { buildFcUserPanel } = require('./ui/fcUser');
const { buildAdminPanel } = require('./ui/admin');
const { handleButton } = require('./interactions/buttons');
const { handleModal } = require('./interactions/modals');

// Load config.json
const configPath = path.join(__dirname, '..', 'config.json');
let appConfig = { FC_Lodestone_ID: '', FC_Leader_Discord_ID: '', Currency_Name: 'Gil', Currency_Daily_Reward: 100 };
try {
  if (fs.existsSync(configPath)) {
    appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (err) {
  console.warn('Failed to read config.json, using defaults.', err);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// Message prefix commands removed to favor slash + button interactions

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: `${appConfig.Currency_Name} economy`, type: ActivityType.Playing }],
    status: 'online'
  });

  // Register slash commands (global by default; if GUILD_ID provided, register per-guild for faster updates)
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  const commands = [
    { name: 'fc', description: 'FC actions panel' },
    { name: 'fcadmin', description: 'FC admin panel (Manage Server required)' },
    {
      name: 'fcuser',
      description: 'View FC info for a user',
      options: [
        {
          name: 'user',
          description: 'User to view',
          type: 6,
          required: true
        }
      ]
    }
  ];
  const appId = process.env.DISCORD_CLIENT_ID;
  (async () => {
    try {
      if (process.env.GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(appId, process.env.GUILD_ID), { body: commands });
        console.log('Registered guild slash commands.');
      } else {
        await rest.put(Routes.applicationCommands(appId), { body: commands });
        console.log('Registered global slash commands.');
      }
    } catch (e) {
      console.error('Failed to register slash commands:', e);
    }
  })();
});

// No messageCreate command handling

// Interactions: slash commands and buttons
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.type === InteractionType.ApplicationCommand) {
      if (interaction.commandName === 'fc') {
        const panel = await buildFcPanel({ discordUser: interaction.user, config: appConfig });
        return void interaction.reply({
          content: panel.content,
          embeds: panel.embeds,
          components: panel.components,
          ephemeral: true
        });
      } else if (interaction.commandName === 'fcadmin') {
        // Require Manage Guild permission
        const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
        if (!hasPerm) {
          return void interaction.reply({ content: 'You need Manage Server permission to use this command.', ephemeral: true });
        }
        const panel = await buildAdminPanel({ user: interaction.user, config: appConfig });
        return void interaction.reply({
          content: panel.content,
          embeds: panel.embeds,
          components: panel.components,
          ephemeral: true
        });
      } else if (interaction.commandName === 'fcuser') {
        const target = interaction.options.getUser('user');
        const panel = await buildFcUserPanel({ targetDiscordId: target.id, config: appConfig, targetUserObj: target });
        return void interaction.reply({
          content: panel.content,
          embeds: panel.embeds,
          components: panel.components,
          ephemeral: true
        });
      }
    } else if (interaction.isButton()) {
      await handleButton(interaction, appConfig);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction, appConfig);
    }
  } catch (err) {
    console.error('interaction error:', err);
    if (interaction.isRepliable && interaction.isRepliable()) {
      try { await interaction.reply({ content: 'There was an error handling that interaction.', ephemeral: true }); } catch {}
    }
  }
});

// Start bot
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN in environment.');
  process.exit(1);
}

client.login(token);
