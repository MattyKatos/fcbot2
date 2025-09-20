const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getUserByDiscordId } = require('../services/db-helpers');
const { countCharactersByDiscordId, getPrimaryCharacterByDiscordId } = require('../services/characters');

async function buildFcPanel({ discordUser, config }) {
  const user = await getUserByDiscordId(discordUser.id);
  const hasUser = !!user;
  const charCount = hasUser ? await countCharactersByDiscordId(discordUser.id) : 0;
  const primary = hasUser ? await getPrimaryCharacterByDiscordId(discordUser.id) : null;
  const avatar = (hasUser && user.pfp_url) ? user.pfp_url : (typeof discordUser.displayAvatarURL === 'function' ? discordUser.displayAvatarURL() : null);
  const currencyName = String(config?.Currency_Name ?? 'Currency');
  const fcName = String(config?.FC_Name ?? 'FC Panel');

  const content = `# ${fcName}\n-# User Panel`;
  const embeds = [
    new EmbedBuilder()
      .setTitle(fcName)
      .setDescription(
        [
          hasUser ? `Registered as: <@${discordUser.id}>` : 'Not registered yet',
          hasUser ? `${currencyName}: ${user.currency}` : '',
          hasUser ? `Characters linked: ${charCount}` : '',
          hasUser ? `Primary Character: ${primary ? (primary.character_name || primary.lodestone_id) : 'None'}` : ''
        ].filter(Boolean).join('\n')
      )
      .setColor(0xff5500)
      .setThumbnail(avatar || null)
  ];

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fc_register_user')
      .setLabel('Register User')
      .setStyle(ButtonStyle.Success)
      .setDisabled(hasUser),
    new ButtonBuilder()
      .setCustomId('fc_remove_user')
      .setLabel('Remove User')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasUser),
    new ButtonBuilder()
      .setCustomId('fc_claim_daily')
      .setLabel('Claim Daily')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasUser)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fc_manage_characters')
      .setLabel('Manage Characters')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasUser)
  );

  return { content, embeds, components: [row1, row2] };
}

module.exports = { buildFcPanel };
