const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function buildEditCharacterPanel({ character }) {
  const emb = new EmbedBuilder()
    .setTitle('Edit Character')
    .setColor(0xffaa00)
    .setDescription([
      `Character: ${character.character_name || character.lodestone_id}`,
      `Lodestone ID: ${character.lodestone_id}`,
      `Primary: ${character.is_primary ? 'Yes' : 'No'}`,
    ].join('\n'));

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fc_char_primary_${character.lodestone_id}`)
      .setLabel(character.is_primary ? '❌ Remove Primary' : '⭐ Set Primary')
      .setStyle(character.is_primary ? ButtonStyle.Secondary : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`fc_char_sync_${character.lodestone_id}`)
      .setLabel('🔁 Sync')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fc_char_delete_${character.lodestone_id}`)
      .setLabel('🗑️ Delete')
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [emb], components: [row1], content: null };
}

module.exports = { buildEditCharacterPanel };
