const { getPool } = require('../db');
const { addLog } = require('./logs');

async function removeUserByDiscordId(discordId) {
  const pool = await getPool();
  const [[user]] = await pool.query('SELECT user_id FROM users WHERE user_discord_id = ?', [discordId]);
  if (!user) return { removed: false };
  await pool.query('DELETE FROM users WHERE user_id = ?', [user.user_id]);
  await addLog({ user_id: user.user_id, log_type: 'user', log_description: 'User removed and cascaded' });
  return { removed: true };
}

module.exports = { removeUserByDiscordId };
