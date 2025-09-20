const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserByDiscordId } = require('../services/db-helpers');
const { countCharactersByDiscordId, getPrimaryCharacterByDiscordId } = require('../services/characters');

async function buildFcUserPanel({ targetDiscordId, config, targetUserObj = null }) {
  const user = await getUserByDiscordId(targetDiscordId);
  const hasUser = !!user;
  const charCount = hasUser ? await countCharactersByDiscordId(targetDiscordId) : 0;
  const primary = hasUser ? await getPrimaryCharacterByDiscordId(targetDiscordId) : null;

  const currencyName = String(config?.Currency_Name ?? 'Currency');
  const fcName = String(config?.FC_Name ?? 'FC Panel');

  const displayName = (user?.display_name || user?.user_name || targetUserObj?.globalName || targetUserObj?.username || targetDiscordId);

  const content = `# ${fcName}\n-# User Lookup`;
  const embeds = [
    new EmbedBuilder()
      .setTitle(`${displayName}`)
      .setDescription(
        [
          `User: <@${targetDiscordId}>`,
          hasUser ? `${currencyName}: ${user.currency}` : 'Not registered yet',
          hasUser ? `Characters linked: ${charCount}` : '',
          hasUser ? `Primary Character: ${primary ? (primary.character_name || primary.lodestone_id) : 'None'}` : ''
        ].filter(Boolean).join('\n')
      )
      .setColor(0x00a86b)
  ];

  const components = [];
  if (hasUser) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`fc_user_give_cur_${targetDiscordId}`)
          .setLabel(`Give ${currencyName}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`fc_user_challenge_deathroll_${targetDiscordId}`)
          .setLabel('Challenge to Deathroll')
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  return { content, embeds, components };
}

module.exports = { buildFcUserPanel };
