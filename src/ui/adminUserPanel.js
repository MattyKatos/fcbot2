const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getUserByDiscordId } = require('../services/db-helpers');
const { countCharactersByDiscordId, getPrimaryCharacterByDiscordId } = require('../services/characters');

async function buildAdminUserPanel({ target, config }) {
  const currencyName = String(config?.Currency_Name ?? 'Currency');
  const fcName = String(config?.FC_Name ?? 'FC Panel');

  const discordId = String(target.user_discord_id);
  const user = await getUserByDiscordId(discordId);
  const hasUser = !!user;
  const charCount = hasUser ? await countCharactersByDiscordId(discordId) : 0;
  const primary = hasUser ? await getPrimaryCharacterByDiscordId(discordId) : null;

  const content = `# ${fcName}\n-# User Panel`;
  const embeds = [
    new EmbedBuilder()
      .setTitle(`Editing ${target.display_name || target.user_name || user?.display_name || user?.user_name || discordId}`)
      .setDescription(
        [
          `User: <@${discordId}>`,
          hasUser ? `${currencyName}: ${user.currency}` : '',
          hasUser ? `Characters linked: ${charCount}` : '',
          hasUser ? `Primary Character: ${primary ? (primary.character_name || primary.lodestone_id) : 'None'}` : ''
        ].filter(Boolean).join('\n')
      )
      .setColor(0x2b2d31)
  ];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fc_admin_user_register_char_${target.user_id}`)
      .setLabel('➕ Register Character')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`fc_admin_user_add_cur_${target.user_id}`)
      .setLabel('➕💰 Add Currency')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fc_admin_user_take_cur_${target.user_id}`)
      .setLabel('➖💰 Take Currency')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fc_admin_user_delete_${target.user_id}`)
      .setLabel('🗑️ Delete User')
      .setStyle(ButtonStyle.Danger)
  );

  return { content, embeds, components: [row1] };
}

module.exports = { buildAdminUserPanel };
