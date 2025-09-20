require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { getPool } = require('../db');

// Basic config (prefer config.json, then env)
let appConfig = {};
try {
  const cfgPath = path.join(process.cwd(), 'config.json');
  if (fs.existsSync(cfgPath)) {
    appConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) || {};
  }
} catch {}
const PORT = Number(appConfig.Web_Port || process.env.WEB_PORT || 3000);
const BASE_URL = (appConfig.Web_Base_URL || process.env.WEB_BASE_URL || `http://localhost:${PORT}`);
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me';

// Passport serialization (store minimal data)
passport.serializeUser((user, done) => done(null, { id: user.id, username: user.username, avatar: user.avatar, global_name: user.global_name }));
passport.deserializeUser((obj, done) => done(null, obj));

// Strategy: Discord OAuth2 (identify only)
passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: `${BASE_URL}/auth/discord/callback`,
  scope: ['identify']
}, (accessToken, refreshToken, profile, done) => {
  // profile contains id, username, global_name, avatar, etc.
  return done(null, profile);
}));

const app = express();

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Static assets (optional)
app.use('/static', express.static(path.join(__dirname, 'public')));

// Sessions
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());
app.use(express.urlencoded({ extended: true }));

// Helpers
function ensureAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  return res.redirect('/auth/discord');
}

async function ensureAdmin(req, res, next) {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated())) return res.redirect('/auth/discord');
    const pool = await getPool();
    const [[u]] = await pool.query('SELECT is_admin FROM users WHERE user_discord_id = ?', [String(req.user.id)]);
    if (u && Number(u.is_admin) === 1) return next();
  } catch {}
  return res.status(403).send('Forbidden');
}

// Routes: auth
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/auth/fail' }), async (req, res) => {
  res.redirect('/dashboard');
});
app.get('/auth/fail', (req, res) => {
  res.status(401).send('Authentication failed. Try again.');
});
app.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/');
  });
});

// Home -> redirect to dashboard or login
app.get('/', (req, res) => {
  if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/dashboard');
  return res.redirect('/auth/discord');
});

// Dashboard
app.get('/dashboard', ensureAuth, async (req, res) => {
  const pool = await getPool();
  // counts
  const [[{ users }]] = await pool.query('SELECT COUNT(*) AS users FROM users');
  const [[{ characters }]] = await pool.query('SELECT COUNT(*) AS characters FROM characters');
  const [[{ characters_registered }]] = await pool.query(`
    SELECT COUNT(*) AS characters_registered
    FROM characters c
    JOIN users u ON u.user_id = c.user_id
    WHERE u.user_name <> 'Unlinked'
  `);
  const [[{ members }]] = await pool.query('SELECT COUNT(*) AS members FROM members');
  const [[{ ranks }]] = await pool.query('SELECT COUNT(*) AS ranks FROM ranks');
  const [[{ roles }]] = await pool.query('SELECT COUNT(*) AS roles FROM roles');
  const [[{ channels }]] = await pool.query('SELECT COUNT(*) AS channels FROM channels');
  const [[{ logs }]] = await pool.query('SELECT COUNT(*) AS logs FROM logs');

  // check admin flag for this viewer
  const [[u]] = await pool.query('SELECT is_admin FROM users WHERE user_discord_id = ?', [String(req.user.id)]);
  const isAdmin = u ? Number(u.is_admin) === 1 : false;

  res.render('dashboard', {
    user: req.user,
    counts: { users, characters, characters_registered, members, ranks, roles, channels, logs },
    baseUrl: BASE_URL,
    isAdmin,
  });
});

// Ranks management: map each rank to a Discord role
app.get('/ranks', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const [ranks] = await pool.query('SELECT rank_id, rank_name, discord_role_id FROM ranks ORDER BY rank_name ASC');
  const guildId = process.env.GUILD_ID ? String(process.env.GUILD_ID) : null;
  let roles;
  if (guildId) {
    [roles] = await pool.query('SELECT discord_role_id, role_name FROM roles WHERE guild_id = ? ORDER BY role_name ASC', [guildId]);
  } else {
    [roles] = await pool.query('SELECT discord_role_id, role_name FROM roles ORDER BY role_name ASC');
  }
  res.render('ranks', { user: req.user, ranks, roles, baseUrl: BASE_URL, saved: false });
});

app.post('/ranks', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const [ranks] = await pool.query('SELECT rank_id FROM ranks');
  for (const r of ranks) {
    const field = `rank_${r.rank_id}`;
    if (Object.prototype.hasOwnProperty.call(req.body, field)) {
      const val = req.body[field];
      const roleId = val && String(val).trim().length ? String(val).trim() : null;
      await pool.query('UPDATE ranks SET discord_role_id = ? WHERE rank_id = ?', [roleId, r.rank_id]);
    }
  }
  const [ranksAfter] = await pool.query('SELECT rank_id, rank_name, discord_role_id FROM ranks ORDER BY rank_name ASC');
  const guildId = process.env.GUILD_ID ? String(process.env.GUILD_ID) : null;
  let roles;
  if (guildId) {
    [roles] = await pool.query('SELECT discord_role_id, role_name FROM roles WHERE guild_id = ? ORDER BY role_name ASC', [guildId]);
  } else {
    [roles] = await pool.query('SELECT discord_role_id, role_name FROM roles ORDER BY role_name ASC');
  }
  res.render('ranks', { user: req.user, ranks: ranksAfter, roles, baseUrl: BASE_URL, saved: true });
});

// Roles management: set priority and multiple flag
app.get('/roles', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const guildId = process.env.GUILD_ID ? String(process.env.GUILD_ID) : null;
  let roles;
  if (guildId) {
    [roles] = await pool.query('SELECT discord_role_id, role_name, role_priority, can_have_multiple, can_be_auto_assigned FROM roles WHERE guild_id = ? ORDER BY role_name ASC', [guildId]);
  } else {
    [roles] = await pool.query('SELECT discord_role_id, role_name, role_priority, can_have_multiple, can_be_auto_assigned FROM roles ORDER BY role_name ASC');
  }
  res.render('roles', { user: req.user, roles, baseUrl: BASE_URL, saved: false });
});

app.post('/roles', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  try { console.log('POST /roles body keys:', Object.keys(req.body)); } catch {}
  // Parse submitted keys directly to avoid bigint precision issues
  const keys = Object.keys(req.body || {});
  const ids = new Set();
  for (const k of keys) {
    const m = k.match(/^(priority|multi|auto)_(\d+)$/);
    if (m) ids.add(m[2]);
  }
  for (const id of ids) {
    const priVal = Number(req.body[`priority_${id}`]);
    const priority = Number.isFinite(priVal) ? priVal : 0;
    const canMulti = req.body[`multi_${id}`] ? 1 : 0;
    const canAuto = req.body[`auto_${id}`] ? 1 : 0;
    await pool.query('UPDATE roles SET role_priority = ?, can_have_multiple = ?, can_be_auto_assigned = ? WHERE discord_role_id = ?', [priority, canMulti, canAuto, id]);
  }
  const guildId = process.env.GUILD_ID ? String(process.env.GUILD_ID) : null;
  let rolesAfter;
  if (guildId) {
    [rolesAfter] = await pool.query('SELECT discord_role_id, role_name, role_priority, can_have_multiple, can_be_auto_assigned FROM roles WHERE guild_id = ? ORDER BY role_name ASC', [guildId]);
  } else {
    [rolesAfter] = await pool.query('SELECT discord_role_id, role_name, role_priority, can_have_multiple, can_be_auto_assigned FROM roles ORDER BY role_name ASC');
  }
  res.render('roles', { user: req.user, roles: rolesAfter, baseUrl: BASE_URL, saved: true });
});

// Manage Users (admin only)
app.get('/users', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const [users] = await pool.query(`
    SELECT u.user_id, u.user_discord_id, u.user_name, u.display_name, u.currency, u.is_admin,
           (SELECT COUNT(*) FROM characters c WHERE c.user_id = u.user_id) AS char_count
    FROM users u
    WHERE u.user_name <> 'Unlinked'
    ORDER BY u.joined DESC
  `);
  res.render('users', { user: req.user, users, baseUrl: BASE_URL, notice: null });
});

app.post('/users/currency', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const userId = Number(req.body.user_id);
  const amt = Number(req.body.amount);
  const op = String(req.body.op || 'add');
  if (!Number.isFinite(userId) || !Number.isFinite(amt)) {
    return res.status(400).send('Bad request');
  }
  const delta = op === 'remove' ? -Math.abs(amt) : Math.abs(amt);
  await pool.query('UPDATE users SET currency = currency + ? WHERE user_id = ?', [delta, userId]);
  // Optional: log entry
  try {
    await pool.query('INSERT INTO logs (user_id, log_type, log_description) VALUES (?, "currency", ?)', [userId, `Admin ${delta >= 0 ? 'added' : 'removed'} ${Math.abs(delta)} via web`]);
  } catch {}
  const [users] = await pool.query(`
    SELECT u.user_id, u.user_discord_id, u.user_name, u.display_name, u.currency, u.is_admin,
           (SELECT COUNT(*) FROM characters c WHERE c.user_id = u.user_id) AS char_count
    FROM users u
    WHERE u.user_name <> 'Unlinked'
    ORDER BY u.joined DESC
  `);
  res.render('users', { user: req.user, users, baseUrl: BASE_URL, notice: 'Currency updated.' });
});

app.post('/users/delete', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const discordId = String(req.body.discord_id || '');
  if (!discordId) return res.status(400).send('Bad request');
  try {
    await pool.query('DELETE FROM users WHERE user_discord_id = ?', [discordId]);
  } catch {}
  const [users] = await pool.query(`
    SELECT u.user_id, u.user_discord_id, u.user_name, u.display_name, u.currency, u.is_admin,
           (SELECT COUNT(*) FROM characters c WHERE c.user_id = u.user_id) AS char_count
    FROM users u
    WHERE u.user_name <> 'Unlinked'
    ORDER BY u.joined DESC
  `);
  res.render('users', { user: req.user, users, baseUrl: BASE_URL, notice: 'User deleted.' });
});

// --- Manage Characters (admin only) ---
async function ensureUnlinkedUserId(pool) {
  const [[u]] = await pool.query("SELECT user_id FROM users WHERE user_name = 'Unlinked' LIMIT 1");
  if (u) return u.user_id;
  // Create a placeholder Unlinked user with discord id 0
  await pool.query(
    "INSERT INTO users (user_discord_id, user_name, display_name, pfp_url, is_member, is_admin, joined) VALUES (0, 'Unlinked', 'Unlinked', NULL, 0, 0, CURRENT_TIMESTAMP)"
  );
  const [[created]] = await pool.query("SELECT user_id FROM users WHERE user_name = 'Unlinked' LIMIT 1");
  return created.user_id;
}

app.get('/characters', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const [characters] = await pool.query(`
    SELECT c.lodestone_id, c.character_name, c.user_id, c.is_verified,
           u.display_name AS user_display, u.user_name AS user_name
    FROM characters c
    LEFT JOIN users u ON u.user_id = c.user_id
    ORDER BY c.added DESC
  `);
  const [users] = await pool.query("SELECT user_id, display_name, user_name FROM users WHERE user_name <> 'Unlinked' ORDER BY joined DESC");
  res.render('characters', { user: req.user, characters, users, baseUrl: BASE_URL, notice: null });
});

app.post('/characters/link', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const lodestoneId = String(req.body.lodestone_id || '');
  const userId = Number(req.body.user_id);
  if (!lodestoneId || !Number.isFinite(userId)) return res.status(400).send('Bad request');
  await pool.query('UPDATE characters SET user_id = ? WHERE lodestone_id = ?', [userId, lodestoneId]);
  const [characters] = await pool.query(`
    SELECT c.lodestone_id, c.character_name, c.user_id, c.is_verified,
           u.display_name AS user_display, u.user_name AS user_name
    FROM characters c LEFT JOIN users u ON u.user_id = c.user_id ORDER BY c.added DESC
  `);
  const [users] = await pool.query("SELECT user_id, display_name, user_name FROM users WHERE user_name <> 'Unlinked' ORDER BY joined DESC");
  res.render('characters', { user: req.user, characters, users, baseUrl: BASE_URL, notice: 'Character linked.' });
});

app.post('/characters/unlink', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const lodestoneId = String(req.body.lodestone_id || '');
  if (!lodestoneId) return res.status(400).send('Bad request');
  const unlinkedId = await ensureUnlinkedUserId(pool);
  await pool.query('UPDATE characters SET user_id = ? WHERE lodestone_id = ?', [unlinkedId, lodestoneId]);
  const [characters] = await pool.query(`
    SELECT c.lodestone_id, c.character_name, c.user_id, c.is_verified,
           u.display_name AS user_display, u.user_name AS user_name
    FROM characters c LEFT JOIN users u ON u.user_id = c.user_id ORDER BY c.added DESC
  `);
  const [users] = await pool.query("SELECT user_id, display_name, user_name FROM users WHERE user_name <> 'Unlinked' ORDER BY joined DESC");
  res.render('characters', { user: req.user, characters, users, baseUrl: BASE_URL, notice: 'Character unlinked.' });
});

app.post('/characters/verify', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const lodestoneId = String(req.body.lodestone_id || '');
  if (!lodestoneId) return res.status(400).send('Bad request');
  await pool.query('UPDATE characters SET is_verified = 1 WHERE lodestone_id = ?', [lodestoneId]);
  const [characters] = await pool.query(`
    SELECT c.lodestone_id, c.character_name, c.user_id, c.is_verified,
           u.display_name AS user_display, u.user_name AS user_name
    FROM characters c LEFT JOIN users u ON u.user_id = c.user_id ORDER BY c.added DESC
  `);
  const [users] = await pool.query("SELECT user_id, display_name, user_name FROM users WHERE user_name <> 'Unlinked' ORDER BY joined DESC");
  res.render('characters', { user: req.user, characters, users, baseUrl: BASE_URL, notice: 'Character verified.' });
});

// --- Manage Members (admin only) ---
app.get('/members', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const [members] = await pool.query(`
    SELECT m.lodestone_id, m.member_name, m.rank_name, m.\`exists\` AS exists_flag
    FROM members m
    ORDER BY m.rank_name ASC, m.member_name ASC
  `);
  res.render('members', { user: req.user, members, baseUrl: BASE_URL });
});

// --- Manage Channels (admin only) ---
app.get('/channels', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const [channels] = await pool.query('SELECT channel_id, channel_discord_id, channel_name, channel_use FROM channels ORDER BY channel_name ASC');
  res.render('channels', { user: req.user, channels, baseUrl: BASE_URL, saved: false });
});

app.post('/channels', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  // Expect form fields like use_<channel_id>
  const keys = Object.keys(req.body || {});
  const ids = new Set();
  for (const k of keys) {
    const m = k.match(/^use_(\d+)$/);
    if (m) ids.add(Number(m[1]));
  }
  for (const id of ids) {
    // allow only 'gamba' or blank
    const val = String(req.body[`use_${id}`] || '').trim();
    const use = val === 'gamba' ? 'gamba' : '';
    await pool.query('UPDATE channels SET channel_use = ? WHERE channel_id = ?', [use || 'unspecified', id]);
  }
  const [channels] = await pool.query('SELECT channel_id, channel_discord_id, channel_name, channel_use FROM channels ORDER BY channel_name ASC');
  res.render('channels', { user: req.user, channels, baseUrl: BASE_URL, saved: true });
});

// --- Logs Viewer (admin only) ---
app.get('/logs', ensureAdmin, async (req, res) => {
  const pool = await getPool();
  const [logs] = await pool.query(`
    SELECT l.log_id, l.user_id, l.log_type, l.log_description, l.\`timestamp\`,
           u.display_name, u.user_name
    FROM logs l
    LEFT JOIN users u ON u.user_id = l.user_id
    ORDER BY l.\`timestamp\` DESC
    LIMIT 500
  `);
  res.render('logs', { user: req.user, logs, baseUrl: BASE_URL });
});
// Start server
app.listen(PORT, () => {
  console.log(`Web server listening on ${BASE_URL}`);
});
