const { getPool } = require('../db');
const { ensureUserByDiscordId } = require('./db-helpers');
const { addLog } = require('./logs');

async function getBalance(discordId) {
  const pool = await getPool();
  const [[row]] = await pool.query('SELECT currency FROM users WHERE user_discord_id = ?', [discordId]);
  return row ? Number(row.currency) : 0;
}

async function claimDaily(discordUser, dailyAmount, currencyName = 'Gil') {
  // Ensure user exists (and keep pfp up to date)
  const pfp = typeof discordUser.displayAvatarURL === 'function' ? discordUser.displayAvatarURL() : null;
  const user = await ensureUserByDiscordId(
    discordUser.id,
    discordUser.username,
    discordUser.globalName || discordUser.displayName || discordUser.username,
    pfp
  );

  const pool = await getPool();

  // Check if user has already claimed today by querying logs
  const [rows] = await pool.query(
    `SELECT 1 FROM logs WHERE user_id = ? AND log_type = 'daily' AND DATE(\`timestamp\`) = CURDATE() LIMIT 1`,
    [user.user_id]
  );

  if (rows.length > 0) {
    return { claimed: false, balance: user.currency };
  }

  // Update balance only (streaks are not used for daily claims)
  await pool.query(`UPDATE users SET currency = currency + ? WHERE user_id = ?`, [dailyAmount, user.user_id]);

  await addLog({ user_id: user.user_id, log_type: 'daily', log_description: `Claimed daily +${dailyAmount} ${currencyName}` });
  await addLog({ user_id: user.user_id, log_type: 'currency', log_description: `Balance change +${dailyAmount} ${currencyName}` });

  const [[updated]] = await pool.query('SELECT currency FROM users WHERE user_id = ?', [user.user_id]);

  return { claimed: true, balance: Number(updated.currency) };
}

module.exports = { getBalance, claimDaily };
