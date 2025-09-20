const { getPool } = require('../db');

async function ensureUserByDiscordId(discordId, userName = null, displayName = null, pfpUrl = null) {
  const pool = await getPool();
  const [[existing]] = await pool.query('SELECT * FROM users WHERE user_discord_id = ?', [discordId]);
  if (existing) {
    // Update name/display/pfp if changed
    const updates = [];
    const params = [];
    if (userName && userName !== existing.user_name) { updates.push('user_name = ?'); params.push(userName); }
    if (displayName && displayName !== existing.display_name) { updates.push('display_name = ?'); params.push(displayName); }
    if (pfpUrl && pfpUrl !== existing.pfp_url) { updates.push('pfp_url = ?'); params.push(pfpUrl); }
    if (updates.length) {
      params.push(existing.user_id);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE user_id = ?`, params);
    }
    const [[refreshed]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [existing.user_id]);
    return refreshed;
  }
  const name = userName || `user_${discordId}`;
  await pool.query(
    'INSERT INTO users (user_discord_id, user_name, display_name, pfp_url, joined) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
    [discordId, name, displayName, pfpUrl]
  );
  const [[created]] = await pool.query('SELECT * FROM users WHERE user_discord_id = ?', [discordId]);
  return created;
}

async function getUserByDiscordId(discordId) {
  const pool = await getPool();
  const [[user]] = await pool.query('SELECT * FROM users WHERE user_discord_id = ?', [discordId]);
  return user || null;
}

module.exports = { ensureUserByDiscordId, getUserByDiscordId };
