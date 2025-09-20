const { getPool } = require('../db');
const { getUserByDiscordId, ensureUserByDiscordId } = require('./db-helpers');
const { addLog } = require('./logs');
const { scrapeCharacterName } = require('../scraper');

async function countCharactersByDiscordId(discordId) {
  const pool = await getPool();
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM characters c
     JOIN users u ON u.user_id = c.user_id
     WHERE u.user_discord_id = ?`, [discordId]
  );
  return Number(row?.cnt || 0);
}

// Admin utility: register/link a character directly to a specific user_id
async function registerCharacterForUserId(user_id, lodestoneId, characterName = null) {
  const pool = await getPool();
  // Check existing character
  const [[existing]] = await pool.query(
    `SELECT c.lodestone_id, c.user_id, u.user_discord_id
     FROM characters c JOIN users u ON u.user_id = c.user_id
     WHERE c.lodestone_id = ?`, [lodestoneId]
  );
  if (existing) {
    if (String(existing.user_id) !== String(user_id)) {
      // Transfer ownership
      await pool.query('UPDATE characters SET user_id = ? WHERE lodestone_id = ?', [user_id, lodestoneId]);
    }
    // Set primary if none
    const [[hasPrimary2]] = await pool.query('SELECT 1 FROM characters WHERE user_id = ? AND is_primary = 1 LIMIT 1', [user_id]);
    if (!hasPrimary2) {
      await pool.query('UPDATE characters SET is_primary = 1 WHERE lodestone_id = ?', [lodestoneId]);
    }
    // Update name if provided
    if (characterName) {
      await pool.query('UPDATE characters SET character_name = ? WHERE lodestone_id = ?', [characterName, lodestoneId]);
    }
    await addLog({ user_id, log_type: 'character', log_description: `Linked existing character ${lodestoneId} to user` });
    return { created: true, linked: true };
  }

  // Determine primary
  const [[hasPrimary]] = await pool.query('SELECT 1 FROM characters WHERE user_id = ? AND is_primary = 1 LIMIT 1', [user_id]);
  const makePrimary = !hasPrimary;
  await pool.query(
    'INSERT INTO characters (lodestone_id, character_name, user_id, is_verified, is_primary, added) VALUES (?, ?, ?, 0, ?, CURRENT_TIMESTAMP)',
    [lodestoneId, characterName, user_id, makePrimary ? 1 : 0]
  );
  if (makePrimary) {
    await pool.query('UPDATE characters SET is_primary = 0 WHERE user_id = ? AND lodestone_id <> ?', [user_id, lodestoneId]);
  }
  await addLog({ user_id, log_type: 'character', log_description: `Registered character ${lodestoneId}` });
  return { created: true };
}

async function listCharactersByDiscordId(discordId) {
  const pool = await getPool();
  const [rows] = await pool.query(
    `SELECT c.lodestone_id, c.character_name, c.is_verified, c.is_primary, c.added
     FROM characters c
     JOIN users u ON u.user_id = c.user_id
     WHERE u.user_discord_id = ?
     ORDER BY c.is_primary DESC, c.added DESC`, [discordId]
  );
  return rows;
}

async function registerCharacter(discordUser, lodestoneId, characterName = null) {
  const user = await ensureUserByDiscordId(discordUser.id, discordUser.username, discordUser.globalName || discordUser.displayName || discordUser.username);
  const pool = await getPool();
  // If already exists, check if it's owned by the placeholder 'Unlinked' user (discord id '0'); if so, link it to this user
  const [[existing]] = await pool.query(
    `SELECT c.lodestone_id, c.user_id, u.user_discord_id
     FROM characters c JOIN users u ON u.user_id = c.user_id
     WHERE c.lodestone_id = ?`, [lodestoneId]
  );
  if (existing) {
    if (String(existing.user_discord_id) === '0') {
      // Link to this user
      await pool.query('UPDATE characters SET user_id = ? WHERE lodestone_id = ?', [user.user_id, lodestoneId]);
      // Set primary if user has none
      const [[hasPrimary2]] = await pool.query('SELECT 1 FROM characters WHERE user_id = ? AND is_primary = 1 LIMIT 1', [user.user_id]);
      if (!hasPrimary2) {
        await pool.query('UPDATE characters SET is_primary = 1 WHERE lodestone_id = ?', [lodestoneId]);
      }
      // Optionally update name if provided
      if (characterName) {
        await pool.query('UPDATE characters SET character_name = ? WHERE lodestone_id = ?', [characterName, lodestoneId]);
      }
      await addLog({ user_id: user.user_id, log_type: 'character', log_description: `Linked existing character ${lodestoneId} to user` });
      return { created: true, linked: true };
    }
    return { created: false, reason: 'exists' };
  }
  // Determine if this should be primary (no existing primary)
  const [[hasPrimary]] = await pool.query(
    'SELECT 1 FROM characters WHERE user_id = ? AND is_primary = 1 LIMIT 1',
    [user.user_id]
  );
  const makePrimary = !hasPrimary;

  await pool.query(
    'INSERT INTO characters (lodestone_id, character_name, user_id, is_verified, is_primary, added) VALUES (?, ?, ?, 0, ?, CURRENT_TIMESTAMP)',
    [lodestoneId, characterName, user.user_id, makePrimary ? 1 : 0]
  );

  // Ensure only one primary if we set this one
  if (makePrimary) {
    await pool.query('UPDATE characters SET is_primary = 0 WHERE user_id = ? AND lodestone_id <> ?', [user.user_id, lodestoneId]);
  }
  await addLog({ user_id: user.user_id, log_type: 'character', log_description: `Registered character ${lodestoneId}` });
  return { created: true };
}

async function getPrimaryCharacterByDiscordId(discordId) {
  const pool = await getPool();
  const [[row]] = await pool.query(
    `SELECT c.lodestone_id, c.character_name
     FROM characters c
     JOIN users u ON u.user_id = c.user_id
     WHERE u.user_discord_id = ? AND c.is_primary = 1
     LIMIT 1`, [discordId]
  );
  return row || null;
}

module.exports = { countCharactersByDiscordId, listCharactersByDiscordId, registerCharacter, getPrimaryCharacterByDiscordId };

async function assertCharacterOwnership(pool, discordId, lodestoneId) {
  const [[row]] = await pool.query(
    `SELECT c.lodestone_id, c.user_id FROM characters c JOIN users u ON u.user_id = c.user_id WHERE u.user_discord_id = ? AND c.lodestone_id = ?`,
    [discordId, lodestoneId]
  );
  return row || null;
}

async function setPrimaryByLodestone(discordId, lodestoneId) {
  const pool = await getPool();
  const owned = await assertCharacterOwnership(pool, discordId, lodestoneId);
  if (!owned) return { ok: false, reason: 'not_found' };
  await pool.query('UPDATE characters SET is_primary = 0 WHERE user_id = ?', [owned.user_id]);
  await pool.query('UPDATE characters SET is_primary = 1 WHERE lodestone_id = ?', [lodestoneId]);
  await addLog({ user_id: owned.user_id, log_type: 'character', log_description: `Set primary character ${lodestoneId}` });
  return { ok: true };
}

async function unsetPrimaryByLodestone(discordId, lodestoneId) {
  const pool = await getPool();
  const owned = await assertCharacterOwnership(pool, discordId, lodestoneId);
  if (!owned) return { ok: false, reason: 'not_found' };
  await pool.query('UPDATE characters SET is_primary = 0 WHERE lodestone_id = ?', [lodestoneId]);
  await addLog({ user_id: owned.user_id, log_type: 'character', log_description: `Unset primary character ${lodestoneId}` });
  return { ok: true };
}

async function deleteCharacterByLodestone(discordId, lodestoneId) {
  const pool = await getPool();
  const owned = await assertCharacterOwnership(pool, discordId, lodestoneId);
  if (!owned) return { ok: false, reason: 'not_found' };
  await pool.query('DELETE FROM characters WHERE lodestone_id = ?', [lodestoneId]);
  await addLog({ user_id: owned.user_id, log_type: 'character', log_description: `Deleted character ${lodestoneId}` });
  return { ok: true };
}

async function syncCharacterNameByLodestone(lodestoneId) {
  try {
    const { name } = await scrapeCharacterName(lodestoneId);
    if (!name) return { ok: false, reason: 'no_name' };
    const pool = await getPool();
    await pool.query('UPDATE characters SET character_name = ? WHERE lodestone_id = ?', [name, lodestoneId]);
    return { ok: true, name };
  } catch (e) {
    return { ok: false, reason: 'scrape_failed' };
  }
}

module.exports.setPrimaryByLodestone = setPrimaryByLodestone;
module.exports.unsetPrimaryByLodestone = unsetPrimaryByLodestone;
module.exports.deleteCharacterByLodestone = deleteCharacterByLodestone;
module.exports.syncCharacterNameByLodestone = syncCharacterNameByLodestone;
module.exports.registerCharacterForUserId = registerCharacterForUserId;
