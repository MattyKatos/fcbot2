const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getPool } = require('../db');

async function buildAdminPanel({ user, config }) {
  const fcName = String(config?.FC_Name ?? 'FC Admin');
  const content = `# ${fcName}\n-# Admin Panel`;
  const currencyName = String(config?.Currency_Name ?? 'Currency');

  const pool = await getPool();
  const [[u]] = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM users
    WHERE user_name <> 'Unlinked'
  `);
  const [[c]] = await pool.query(`
    SELECT COUNT(*) AS cnt
    FROM characters c
    JOIN users u ON u.user_id = c.user_id
    WHERE u.user_name <> 'Unlinked'
  `);
  const [[m]] = await pool.query('SELECT COUNT(*) AS cnt FROM members');
  const [[tot]] = await pool.query('SELECT COALESCE(SUM(currency), 0) AS total FROM users');

  const emb = new EmbedBuilder()
    .setTitle(`${fcName} — Admin Panel`)
    .setDescription([
      `Hello <@${user.id}>`,
      '',
      `Discord Users Registered: ${u.cnt}`,
      `FFXIV Characters Registered: ${c.cnt}`,
      `Free Company Members Registered: ${m.cnt}`,
      `Total ${currencyName}: ${Number(tot.total)}`
    ].join('\n'))
    .setColor(0x2b2d31)
    .setThumbnail(config?.FC_Icon || null);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fc_admin_sync_members')
      .setLabel('Sync FC Members')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('fc_admin_manage_users')
      .setLabel('Manage Users')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fc_admin_sync_roles')
      .setLabel('Sync Roles')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fc_admin_sync_channels')
      .setLabel('Sync Channels')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fc_admin_apply_roles')
      .setLabel('Apply Roles')
      .setStyle(ButtonStyle.Primary),
  );

  return { content, embeds: [emb], components: [row] };
}

module.exports = { buildAdminPanel };
