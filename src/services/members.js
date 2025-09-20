const { getPool } = require('../db');
const { scrapeFreeCompanyMembers } = require('../scraper');
const { ensureUserByDiscordId } = require('./db-helpers');

async function syncFreeCompanyMembers(fcLodestoneId) {
  if (!fcLodestoneId) throw new Error('Missing FC Lodestone ID');
  const pool = await getPool();

  const { members } = await scrapeFreeCompanyMembers(fcLodestoneId);
  const foundIds = members.map(m => m.lodestone_id);

  let created = 0;
  let updated = 0;
  let rankChanged = 0;

  // Deactivate (exists = 0) any members not found this run
  let deactivated = 0;
  if (foundIds.length > 0) {
    const [res] = await pool.query(
      `UPDATE members SET \`exists\` = 0 WHERE lodestone_id NOT IN (${foundIds.map(() => '?').join(',')})`,
      foundIds
    );
    deactivated = res.affectedRows || 0;
  } else {
    // No members found -> mark all as not existing
    const [res] = await pool.query('UPDATE members SET `exists` = 0');
    deactivated = res.affectedRows || 0;
  }

  // Upsert each found member
  for (const m of members) {
    // Ensure a character row exists; if not, create with placeholder "Unlinked" user
    let [[charRow]] = await pool.query('SELECT lodestone_id FROM characters WHERE lodestone_id = ?', [m.lodestone_id]);
    if (!charRow) {
      const placeholder = await ensureUserByDiscordId('0', 'Unlinked', null, null);
      await pool.query(
        'INSERT IGNORE INTO characters (lodestone_id, character_name, user_id, is_verified, is_primary, added) VALUES (?, ?, ?, 0, 0, CURRENT_TIMESTAMP)',
        [m.lodestone_id, m.member_name || null, placeholder.user_id]
      );
      [[charRow]] = await pool.query('SELECT lodestone_id FROM characters WHERE lodestone_id = ?', [m.lodestone_id]);
    }

    const [[existing]] = await pool.query('SELECT member_id, rank_name, member_name FROM members WHERE lodestone_id = ?', [m.lodestone_id]);
    if (!existing) {
      await pool.query(
        'INSERT INTO members (lodestone_id, member_name, rank_name, found, `exists`, rank_updated) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1, NULL)',
        [m.lodestone_id, m.member_name, m.rank_name]
      );
      created++;
      continue;
    }

    // Update name and exists
    let doUpdate = false;
    const sets = [];
    const params = [];
    if (m.member_name && m.member_name !== existing.member_name) { sets.push('member_name = ?'); params.push(m.member_name); doUpdate = true; }
    // Rank update handling
    if (m.rank_name && m.rank_name !== existing.rank_name) {
      sets.push('rank_name = ?', 'rank_updated = CURRENT_TIMESTAMP');
      params.push(m.rank_name);
      doUpdate = true;
      rankChanged++;
    }
    // always set exists=1 for found
    sets.push('`exists` = 1');

    if (doUpdate || sets.length) {
      params.push(existing.member_id);
      await pool.query(`UPDATE members SET ${sets.join(', ')} WHERE member_id = ?`, params);
      updated++;
    }
  }

  // Backfill: recompute users.is_member for all users
  await pool.query(`
    UPDATE users u
    SET is_member = EXISTS (
      SELECT 1 FROM characters c
      JOIN members m ON m.lodestone_id = c.lodestone_id AND m.` + '`exists`' + ` = 1
      WHERE c.user_id = u.user_id
    )
  `);

  return { created, updated, rankChanged, deactivated };
}

module.exports = { syncFreeCompanyMembers };
