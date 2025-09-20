const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { listCharactersByDiscordId } = require('../services/characters');

const PAGE_SIZE = 5;

function paginate(list, page, pageSize) {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  const end = start + pageSize;
  return { items: list.slice(start, end), current, totalPages, total };
}

async function buildManageCharactersPanel({ discordUser, page = 1 }) {
  const all = await listCharactersByDiscordId(discordUser.id);
  const { items, current, totalPages } = paginate(all, page, PAGE_SIZE);

  const emb = new EmbedBuilder()
    .setTitle('Manage Characters')
    .setColor(0x5865f2)
    .setDescription(
      items.map((c, idx) => {
        const n = idx + 1;
        const lines = [
          `Character ${n}`,
          `Character Name: ${c.character_name || c.lodestone_id}`,
          `Is Primary: ${c.is_primary ? 'Yes' : 'No'}`,
        ];
        return lines.join('\n');
      }).join('\n\n') || 'No characters registered yet.'
    )
    .setFooter({ text: `Page ${current} / ${totalPages}` });

  // Row with Prev(⬅️), Add(➕), Search(🔍 link), Next(➡️)
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fc_chars_prev_${current}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current <= 1),
    new ButtonBuilder()
      .setCustomId('fc_register_character')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL('https://na.finalfantasyxiv.com/lodestone/community/')
      .setEmoji('🔍'),
    new ButtonBuilder()
      .setCustomId(`fc_chars_next_${current}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current >= totalPages)
  );

  // Row with edit buttons labeled with emoji digits
  const emojiDigits = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'];
  const numberRow = new ActionRowBuilder();
  items.forEach((_, idx) => {
    const n = idx + 1;
    const emoji = emojiDigits[idx] || String(n);
    numberRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`fc_chars_edit_${n}_${current}`)
        .setLabel(`Edit ${emoji}`)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  const components = [];
  components.push(navRow);
  if (items.length > 0) components.push(numberRow);

  return { embeds: [emb], components, content: null };
}

module.exports = { buildManageCharactersPanel, PAGE_SIZE };
