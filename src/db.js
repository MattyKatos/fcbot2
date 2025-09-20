require('dotenv').config();
const mysql = require('mysql2/promise');

let pool;

async function getPool() {
  if (pool) return pool;

  const host = process.env.DB_HOST || '100.65.234.32';
  const port = Number(process.env.DB_PORT || 3316);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const database = process.env.DB_NAME || 'fcbot';

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    supportBigNumbers: true,
    bigNumberStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  return pool;
}

module.exports = { getPool };
