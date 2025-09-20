const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getPool } = require('../db');

const PAGE_SIZE = 5;

function paginate(total, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return { current, totalPages, start, limit: pageSize };
}

async function fetchUsersPage({ page }) {
  const pool = await getPool();
  const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE user_name <> 'Unlinked'");
  const { current, totalPages, start, limit } = paginate(cnt, page, PAGE_SIZE);
  const [rows] = await pool.query(
    `SELECT u.user_id, u.user_discord_id, u.user_name, u.display_name, u.is_member, u.currency,
            (SELECT COUNT(*) FROM characters c WHERE c.user_id = u.user_id) AS char_count
     FROM users u
     WHERE u.user_name <> 'Unlinked'
     ORDER BY u.joined DESC
     LIMIT ?, ?`,
    [start, limit]
  );
  return { users: rows, current, totalPages, total: cnt };
}

async function buildManageUsersPanel({ page = 1 }) {
  const { users, current, totalPages } = await fetchUsersPage({ page });
  const emb = new EmbedBuilder()
    .setTitle('Manage Users')
    .setColor(0x5865f2)
    .setDescription(
      users.map((u, idx) => {
        const n = idx + 1;
        const name = u.display_name || u.user_name || `User ${u.user_id}`;
        const discord = u.user_discord_id ? `<@${u.user_discord_id}>` : 'N/A';
        return [
          `User ${n}`,
          `User: ${discord} (${name})`,
          `Is Member: ${u.is_member ? 'Yes' : 'No'}`,
          `Characters: ${u.char_count}`,
          `Currency: ${u.currency}`,
        ].join('\n');
      }).join('\n\n') || 'No users found.'
    )
    .setFooter({ text: `Page ${current} / ${totalPages}` });

  // Nav row: ⬅️ ➡️
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fc_users_prev_${current}`)
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current <= 1),
    new ButtonBuilder()
      .setCustomId(`fc_users_next_${current}`)
      .setEmoji('➡️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(current >= totalPages)
  );

  // Edit buttons row: Edit 1️⃣..5️⃣
  const emojiDigits = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'];
  const editRow = new ActionRowBuilder();
  users.forEach((_, idx) => {
    const n = idx + 1;
    editRow.addComponents(
      new ButtonBuilder()
        .setCustomId(`fc_users_edit_${n}_${current}`)
        .setLabel(`Edit ${emojiDigits[idx] || String(n)}`)
        .setStyle(ButtonStyle.Secondary)
    );
  });

  const components = [navRow];
  if (users.length > 0) components.push(editRow);

  return { embeds: [emb], components, content: null };
}

module.exports = { buildManageUsersPanel, PAGE_SIZE };
