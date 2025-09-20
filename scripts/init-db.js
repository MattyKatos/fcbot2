require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const host = process.env.DB_HOST || '100.65.234.32';
  const port = Number(process.env.DB_PORT || 3316);
  const user = process.env.DB_USER || 'root';
  const password = process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'fcbot';

  console.log(`Connecting to MySQL ${host}:${port} as ${user}...`);
  const conn = await mysql.createConnection({ host, port, user, password, multipleStatements: true });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
    console.log(`Database \`${dbName}\` ensured.`);

    // Switch to the target database
    await conn.changeUser({ database: dbName });

    const sql = `
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_discord_id BIGINT UNSIGNED NOT NULL,
      user_name VARCHAR(64) NOT NULL,
      is_member TINYINT(1) NOT NULL DEFAULT 0,
      is_admin TINYINT(1) NOT NULL DEFAULT 0,
      display_name VARCHAR(64) NULL,
      pfp_url VARCHAR(255) NULL,
      note_public TEXT NULL,
      note_admin TEXT NULL,
      currency BIGINT NOT NULL DEFAULT 0,
      points INT NOT NULL DEFAULT 0,
      streak_current INT NOT NULL DEFAULT 0,
      streak_longest INT NOT NULL DEFAULT 0,
      joined TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id),
      UNIQUE KEY uq_users_discord (user_discord_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS characters (
      lodestone_id BIGINT UNSIGNED NOT NULL,
      character_name VARCHAR(64) NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      is_verified TINYINT(1) NOT NULL DEFAULT 0,
      is_primary TINYINT(1) NOT NULL DEFAULT 0,
      added TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (lodestone_id),
      KEY idx_char_user (user_id),
      CONSTRAINT fk_char_user FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS members (
      member_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      lodestone_id BIGINT UNSIGNED NOT NULL,
      member_name VARCHAR(64) NULL,
      rank_name VARCHAR(64) NOT NULL,
      found TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`exists\` TINYINT(1) NOT NULL DEFAULT 1,
      rank_updated TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (member_id),
      UNIQUE KEY uq_members_lodestone (lodestone_id),
      KEY idx_members_rank_name (rank_name),
      CONSTRAINT fk_members_character FOREIGN KEY (lodestone_id)
        REFERENCES characters(lodestone_id) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS ranks (
      rank_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      rank_name VARCHAR(64) NOT NULL,
      discord_role_id BIGINT UNSIGNED NULL,
      PRIMARY KEY (rank_id),
      UNIQUE KEY uq_ranks_name (rank_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS roles (
      discord_role_id BIGINT UNSIGNED NOT NULL,
      guild_id BIGINT UNSIGNED NOT NULL,
      role_name VARCHAR(128) NOT NULL,
      role_priority INT NOT NULL DEFAULT 0,
      can_have_multiple TINYINT(1) NOT NULL DEFAULT 1,
      can_be_auto_assigned TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (discord_role_id),
      UNIQUE KEY uq_roles_name (role_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS channels (
      channel_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      channel_discord_id BIGINT UNSIGNED NOT NULL,
      channel_name VARCHAR(128) NOT NULL,
      channel_use VARCHAR(32) NOT NULL,
      PRIMARY KEY (channel_id),
      UNIQUE KEY uq_channels_discord (channel_discord_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS gamba (
      gamba_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      gamba_user_id BIGINT UNSIGNED NOT NULL,
      gamba_challenger_id BIGINT UNSIGNED NOT NULL,
      gamba_type VARCHAR(64) NOT NULL,
      gamba_bet INT NOT NULL,
      gamba_status VARCHAR(64) NOT NULL,
      gamba_payload JSON NULL,
      gamba_winner_id BIGINT UNSIGNED NULL,
      PRIMARY KEY (gamba_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS logs (
      log_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id BIGINT UNSIGNED NULL,
      log_type ENUM('user','member','character','currency','daily') NOT NULL,
      log_description TEXT NOT NULL,
      \`timestamp\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (log_id),
      KEY idx_logs_user (user_id),
      CONSTRAINT fk_logs_user FOREIGN KEY (user_id)
        REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;



    await conn.query(sql);

    // --- Post-creation migrations to align existing schemas ---
    // 0) Ensure users.pfp_url exists
    const [pfpCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'pfp_url'
    `, [dbName]);
    if (pfpCol.length === 0) {
      await conn.query('ALTER TABLE users ADD COLUMN pfp_url VARCHAR(255) NULL AFTER display_name');
    }
    // 1) If old column `members.rank` exists, rename to `rank_name`
    const [rankCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'members' AND COLUMN_NAME = 'rank'
    `, [dbName]);
    if (rankCol.length > 0) {
      await conn.query('ALTER TABLE members CHANGE COLUMN `rank` `rank_name` VARCHAR(64) NOT NULL');
    }
    // 1a) Ensure members.member_name exists
    const [memberNameCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'members' AND COLUMN_NAME = 'member_name'
    `, [dbName]);
    if (memberNameCol.length === 0) {
      await conn.query('ALTER TABLE members ADD COLUMN member_name VARCHAR(64) NULL AFTER lodestone_id');
    }

    // 1b) Ensure characters.character_name exists
    const [charNameCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'characters' AND COLUMN_NAME = 'character_name'
    `, [dbName]);
    if (charNameCol.length === 0) {
      await conn.query('ALTER TABLE characters ADD COLUMN character_name VARCHAR(64) NULL AFTER lodestone_id');
    }

    // 1c) Ensure roles.role_priority and roles.can_have_multiple exist
    const [rolePriorityCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'role_priority'
    `, [dbName]);
    if (rolePriorityCol.length === 0) {
      await conn.query('ALTER TABLE roles ADD COLUMN role_priority INT NOT NULL DEFAULT 0 AFTER role_name');
    }
    const [roleMultiCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'can_have_multiple'
    `, [dbName]);
    if (roleMultiCol.length === 0) {
      await conn.query('ALTER TABLE roles ADD COLUMN can_have_multiple TINYINT(1) NOT NULL DEFAULT 0 AFTER role_priority');
    }

    // 1d) Ensure roles.can_be_auto_assigned exists
    const [roleAutoCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'can_be_auto_assigned'
    `, [dbName]);
    if (roleAutoCol.length === 0) {
      await conn.query('ALTER TABLE roles ADD COLUMN can_be_auto_assigned TINYINT(1) NOT NULL DEFAULT 0 AFTER can_have_multiple');
    }

    // 1e) Ensure roles.guild_id exists
    const [roleGuildCol] = await conn.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'guild_id'
    `, [dbName]);
    if (roleGuildCol.length === 0) {
      await conn.query('ALTER TABLE roles ADD COLUMN guild_id BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER discord_role_id');
    }

    // 2) Ensure index on members.rank_name
    const [idxRows] = await conn.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'members' AND INDEX_NAME = 'idx_members_rank_name'
    `, [dbName]);
    if (idxRows.length === 0) {
      await conn.query('CREATE INDEX idx_members_rank_name ON members (rank_name)');
    }

    // 3) Ensure FK from members.rank_name -> ranks.rank_name
    const [fkRows] = await conn.query(`
      SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'members' AND COLUMN_NAME = 'rank_name' AND REFERENCED_TABLE_NAME = 'ranks'
    `, [dbName]);
    if (fkRows.length === 0) {
      // Drop any conflicting FK on rank/rank_name only
      const [toDrop] = await conn.query(`
        SELECT k.CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = 'members'
          AND k.COLUMN_NAME IN ('rank','rank_name')
          AND k.REFERENCED_TABLE_NAME IS NOT NULL
      `, [dbName]);
      for (const r of toDrop) {
        try { await conn.query(`ALTER TABLE members DROP FOREIGN KEY \`${r.CONSTRAINT_NAME}\``); } catch {}
      }
      await conn.query('ALTER TABLE members ADD CONSTRAINT fk_members_rank_name FOREIGN KEY (rank_name) REFERENCES ranks(rank_name) ON UPDATE CASCADE');
    }

    // Triggers to auto-insert ranks when a member references a new rank_name
    await conn.query('DROP TRIGGER IF EXISTS before_members_insert');
    await conn.query(`
      CREATE TRIGGER before_members_insert
      BEFORE INSERT ON members
      FOR EACH ROW
      BEGIN
        IF NEW.rank_name IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ranks r WHERE r.rank_name = NEW.rank_name) THEN
          INSERT INTO ranks (rank_name) VALUES (NEW.rank_name);
        END IF;
      END
    `);

    await conn.query('DROP TRIGGER IF EXISTS before_members_update');
    await conn.query(`
      CREATE TRIGGER before_members_update
      BEFORE UPDATE ON members
      FOR EACH ROW
      BEGIN
        IF NEW.rank_name IS NOT NULL AND NEW.rank_name <> OLD.rank_name AND NOT EXISTS (SELECT 1 FROM ranks r WHERE r.rank_name = NEW.rank_name) THEN
          INSERT INTO ranks (rank_name) VALUES (NEW.rank_name);
        END IF;
      END
    `);

    // --- Enforce single primary character per user ---
    // 4) Helpful index for lookups by user and primary flag
    const [primLookupIdx] = await conn.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'characters' AND INDEX_NAME = 'idx_char_user_primary'
    `, [dbName]);
    if (primLookupIdx.length === 0) {
      await conn.query('CREATE INDEX idx_char_user_primary ON characters (user_id, is_primary)');
    }

    // 5) Do NOT create BEFORE triggers on characters that update the same table; enforce primary uniqueness in application layer
    await conn.query('DROP TRIGGER IF EXISTS before_characters_insert');
    await conn.query('DROP TRIGGER IF EXISTS before_characters_update');

    // --- Keep users.is_member in sync with members/characters linkage ---
    // Helpful index: members.exists (optional)
    const [existsIdx] = await conn.query(`
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'members' AND INDEX_NAME = 'idx_members_exists'
    `, [dbName]);
    if (existsIdx.length === 0) {
      await conn.query('CREATE INDEX idx_members_exists ON members (`exists`)');
    }

    // Helper: recompute is_member for a given user_id based on any linked member with exists=1
    // After INSERT on members
    await conn.query('DROP TRIGGER IF EXISTS after_members_insert');
    await conn.query(`
      CREATE TRIGGER after_members_insert
      AFTER INSERT ON members
      FOR EACH ROW
      BEGIN
        SET @uid := (SELECT c.user_id FROM characters c WHERE c.lodestone_id = NEW.lodestone_id LIMIT 1);
        IF @uid IS NOT NULL THEN
          UPDATE users u
          SET is_member = EXISTS (
            SELECT 1 FROM characters c JOIN members m ON m.lodestone_id = c.lodestone_id AND m.\`exists\` = 1
            WHERE c.user_id = @uid
          )
          WHERE u.user_id = @uid;
        END IF;
      END
    `);

    // After UPDATE on members
    await conn.query('DROP TRIGGER IF EXISTS after_members_update');
    await conn.query(`
      CREATE TRIGGER after_members_update
      AFTER UPDATE ON members
      FOR EACH ROW
      BEGIN
        SET @uid := (SELECT c.user_id FROM characters c WHERE c.lodestone_id = NEW.lodestone_id LIMIT 1);
        IF @uid IS NOT NULL THEN
          UPDATE users u
          SET is_member = EXISTS (
            SELECT 1 FROM characters c JOIN members m ON m.lodestone_id = c.lodestone_id AND m.\`exists\` = 1
            WHERE c.user_id = @uid
          )
          WHERE u.user_id = @uid;
        END IF;
      END
    `);

    // After DELETE on members
    await conn.query('DROP TRIGGER IF EXISTS after_members_delete');
    await conn.query(`
      CREATE TRIGGER after_members_delete
      AFTER DELETE ON members
      FOR EACH ROW
      BEGIN
        SET @uid := (SELECT c.user_id FROM characters c WHERE c.lodestone_id = OLD.lodestone_id LIMIT 1);
        IF @uid IS NOT NULL THEN
          UPDATE users u
          SET is_member = EXISTS (
            SELECT 1 FROM characters c JOIN members m ON m.lodestone_id = c.lodestone_id AND m.\`exists\` = 1
            WHERE c.user_id = @uid
          )
          WHERE u.user_id = @uid;
        END IF;
      END
    `);

    // Also when a character's ownership changes, recompute for both old and new owners
    await conn.query('DROP TRIGGER IF EXISTS after_characters_update');
    await conn.query(`
      CREATE TRIGGER after_characters_update
      AFTER UPDATE ON characters
      FOR EACH ROW
      BEGIN
        IF NEW.user_id <> OLD.user_id THEN
          IF OLD.user_id IS NOT NULL THEN
            UPDATE users u
            SET is_member = EXISTS (
              SELECT 1 FROM characters c JOIN members m ON m.lodestone_id = c.lodestone_id AND m.\`exists\` = 1
              WHERE c.user_id = OLD.user_id
            )
            WHERE u.user_id = OLD.user_id;
          END IF;
          IF NEW.user_id IS NOT NULL THEN
            UPDATE users u
            SET is_member = EXISTS (
              SELECT 1 FROM characters c JOIN members m ON m.lodestone_id = c.lodestone_id AND m.\`exists\` = 1
              WHERE c.user_id = NEW.user_id
            )
            WHERE u.user_id = NEW.user_id;
          END IF;
        END IF;
      END
    `);

    console.log('Tables ensured: users, characters, members, ranks, roles, channels, gamba, logs. Triggers installed for rank auto-insert.');
  } finally {
    await conn.end();
  }
})();
