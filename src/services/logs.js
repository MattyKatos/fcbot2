const { getPool } = require('../db');

async function addLog({ user_id = null, log_type, log_description }) {
  const pool = await getPool();
  await pool.query(
    'INSERT INTO logs (user_id, log_type, log_description) VALUES (?, ?, ?)',
    [user_id, log_type, log_description]
  );
}

module.exports = { addLog };
