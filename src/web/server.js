require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { getPool } = require('../db');

// Basic config
const PORT = Number(process.env.WEB_PORT || 3000);
const BASE_URL = process.env.WEB_BASE_URL || `http://localhost:${PORT}`;
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

  res.render('dashboard', {
    user: req.user,
    counts: { users, characters, characters_registered, members, ranks, roles, channels, logs },
    baseUrl: BASE_URL,
  });
});

// Ranks management: map each rank to a Discord role
app.get('/ranks', ensureAuth, async (req, res) => {
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

app.post('/ranks', ensureAuth, async (req, res) => {
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
app.get('/roles', ensureAuth, async (req, res) => {
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

app.post('/roles', ensureAuth, async (req, res) => {
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

// Start server
app.listen(PORT, () => {
  console.log(`Web server listening on ${BASE_URL}`);
});
