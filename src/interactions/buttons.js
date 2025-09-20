const { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField } = require('discord.js');
const { ensureUserByDiscordId, getUserByDiscordId } = require('../services/db-helpers');
const { removeUserByDiscordId } = require('../services/users');
const { claimDaily } = require('../services/economy');
const { countCharactersByDiscordId, listCharactersByDiscordId, setPrimaryByLodestone, unsetPrimaryByLodestone, deleteCharacterByLodestone, syncCharacterNameByLodestone } = require('../services/characters');
const { buildFcPanel } = require('../ui/fc');
const { buildManageCharactersPanel, PAGE_SIZE } = require('../ui/manageCharacters');
const { buildManageUsersPanel, PAGE_SIZE: USERS_PAGE_SIZE } = require('../ui/manageUsers');
const { buildEditCharacterPanel } = require('../ui/editCharacter');
const { buildAdminUserPanel } = require('../ui/adminUserPanel');
const { getPool } = require('../db');
const { syncFreeCompanyMembers } = require('../services/members');

async function refreshPanel(interaction, appConfig) {
  const panel = await buildFcPanel({ discordUser: interaction.user, config: appConfig });
  // Try editing the original reply/message. For button interactions from ephemeral replies, update works.
  try {
    await interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  } catch {
    try {
      await interaction.reply({ content: panel.content, embeds: panel.embeds, components: panel.components, ephemeral: true });
    } catch {}
  }

  // No interaction handling in refreshPanel
}

async function handleButton(interaction, appConfig) {
  const id = interaction.customId;
  if (!id || !interaction.isButton()) return;

  // Admin: Manage Users panel
  if (id === 'fc_admin_manage_users') {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) {
      return interaction.reply({ content: 'You need Manage Server permission to manage users.', ephemeral: true });
    }
    const panel = await buildManageUsersPanel({ page: 1 });
    return interaction.reply({ content: panel.content, embeds: panel.embeds, components: panel.components, ephemeral: true });
  }

  // Admin: Manage Users pagination
  const usersPrev = id.match(/^fc_users_prev_(\d+)$/);
  if (usersPrev) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const current = parseInt(usersPrev[1], 10) || 1;
    const page = Math.max(1, current - 1);
    const panel = await buildManageUsersPanel({ page });
    return interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  }
  const usersNext = id.match(/^fc_users_next_(\d+)$/);
  if (usersNext) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const current = parseInt(usersNext[1], 10) || 1;
    const page = current + 1;
    const panel = await buildManageUsersPanel({ page });
    return interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  }

  // Admin: Manage Users edit selection
  const usersEdit = id.match(/^fc_users_edit_(\d+)_(\d+)$/);
  if (usersEdit) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const n = parseInt(usersEdit[1], 10) || 1;
    const page = parseInt(usersEdit[2], 10) || 1;
    // Fetch the page again to resolve the selected user
    const pool = await getPool();
    const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE user_name <> 'Unlinked'");
    const totalPages = Math.max(1, Math.ceil(cnt / 5));
    const current = Math.min(Math.max(1, page), totalPages);
    const start = (current - 1) * 5;
    const [rows] = await pool.query(
      `SELECT u.user_id, u.user_discord_id, u.user_name, u.display_name, u.is_member, u.currency
       FROM users u WHERE u.user_name <> 'Unlinked' ORDER BY u.joined DESC LIMIT ?, ?`,
      [start, 5]
    );
    const userRow = rows[n - 1];
    if (!userRow) return interaction.reply({ content: 'User not found on this page.', ephemeral: true });
    const panel = await buildAdminUserPanel({ target: userRow, config: appConfig });
    return interaction.reply({ content: panel.content, embeds: panel.embeds, components: panel.components, ephemeral: true });
  }

  // Admin: open Register Character modal for target user
  const adminRegChar = id.match(/^fc_admin_user_register_char_(\d+)$/);
  if (adminRegChar) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetUserId = parseInt(adminRegChar[1], 10);
    const modal = new ModalBuilder()
      .setCustomId(`fc_admin_modal_register_character_${targetUserId}`)
      .setTitle('Admin: Register Character for User');
    const input = new TextInputBuilder()
      .setCustomId('lodestone_id')
      .setLabel('Lodestone ID')
      .setPlaceholder('e.g., 37378095')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Admin: open Add Currency modal
  const adminAddCur = id.match(/^fc_admin_user_add_cur_(\d+)$/);
  if (adminAddCur) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetUserId = parseInt(adminAddCur[1], 10);
    const modal = new ModalBuilder()
      .setCustomId(`fc_admin_modal_add_cur_${targetUserId}`)
      .setTitle('Admin: Add Currency');
    const input = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel('Amount to add')
      .setPlaceholder('positive integer')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Admin: open Take Currency modal
  const adminTakeCur = id.match(/^fc_admin_user_take_cur_(\d+)$/);
  if (adminTakeCur) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetUserId = parseInt(adminTakeCur[1], 10);
    const modal = new ModalBuilder()
      .setCustomId(`fc_admin_modal_take_cur_${targetUserId}`)
      .setTitle('Admin: Take Currency');
    const input = new TextInputBuilder()
      .setCustomId('amount')
      .setLabel('Amount to take')
      .setPlaceholder('positive integer')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  // Admin: Delete User
  const adminDel = id.match(/^fc_admin_user_delete_(\d+)$/);
  if (adminDel) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetUserId = parseInt(adminDel[1], 10);
    const pool = await getPool();
    const [[u]] = await pool.query('SELECT user_discord_id FROM users WHERE user_id = ?', [targetUserId]);
    if (!u) return interaction.reply({ content: 'User not found.', ephemeral: true });
    await removeUserByDiscordId(u.user_discord_id);
    return interaction.reply({ content: `User <@${u.user_discord_id}> deleted.`, ephemeral: true });
  }

  // Admin: perform daily claim on behalf of a user
  const adminClaim = id.match(/^fc_admin_user_claim_daily_(\d+)$/);
  if (adminClaim) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetDiscordId = adminClaim[1];
    const pool = await getPool();
    const [[u]] = await pool.query('SELECT * FROM users WHERE user_discord_id = ?', [targetDiscordId]);
    if (!u) return interaction.reply({ content: 'Target user not found.', ephemeral: true });
    const currency = String(appConfig.Currency_Name ?? 'Gil');
    const amtMember = Number(appConfig.Currency_Daily_Reward_Members ?? appConfig.Currency_Daily_Reward ?? 100);
    const amtDefault = Number(appConfig.Currency_Daily_Reward ?? 100);
    const amount = u.is_member ? amtMember : amtDefault;
    const pseudoDiscordUser = {
      id: String(targetDiscordId),
      username: u.user_name,
      displayName: u.display_name,
      globalName: u.display_name,
      displayAvatarURL: () => null
    };
    const result = await claimDaily(pseudoDiscordUser, amount, currency);
    if (!result.claimed) {
      return interaction.reply({ content: `User <@${targetDiscordId}> already claimed today.`, ephemeral: true });
    }
    return interaction.reply({ content: `Claimed daily for <@${targetDiscordId}>: +${amount} ${currency}. New balance: ${result.balance}`, ephemeral: true });
  }

  if (id === 'fc_admin_sync_members') {
    // Permission check
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) {
      return interaction.reply({ content: 'You need Manage Server permission to sync members.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await syncFreeCompanyMembers(appConfig.FC_Lodestone_ID);
      const msg = [
        `Synced FC members from Lodestone.`,
        `Created: ${result.created}`,
        `Updated: ${result.updated}`,
        `Rank changes: ${result.rankChanged}`,
        `Deactivated (not found): ${result.deactivated}`
      ].join('\n');
      return interaction.editReply({ content: msg });
    } catch (e) {
      console.error('sync members error:', e);
      return interaction.editReply({ content: 'Failed to sync FC members.' });
    }
  }

  // Admin: Apply Roles based on primary character's rank mapping
  if (id === 'fc_admin_apply_roles') {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) {
      return interaction.reply({ content: 'You need Manage Server permission to apply roles.', ephemeral: true });
    }
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.guild.roles.fetch();
      const pool = await getPool();
      // Roles with can_have_multiple = 0 are exclusive
      const [rolePolicy] = await pool.query('SELECT discord_role_id, can_have_multiple FROM roles');
      const nonMultiSet = new Set(rolePolicy.filter(r => !Number(r.can_have_multiple)).map(r => String(r.discord_role_id)));

      // Target role via ranks.discord_role_id for the member's primary character rank
      const [rows] = await pool.query(`
        SELECT u.user_discord_id, m.rank_name, rk.discord_role_id AS target_role_id
        FROM users u
        JOIN characters c ON c.user_id = u.user_id AND c.is_primary = 1
        JOIN members m ON m.lodestone_id = c.lodestone_id AND m.\`exists\` = 1
        LEFT JOIN ranks rk ON rk.rank_name = m.rank_name
        WHERE u.user_name <> 'Unlinked'
      `);

      let processed = 0, applied = 0, removed = 0, skipped = 0;
      let skippedNoMapping = 0, skippedRoleNotFound = 0;
      for (const row of rows) {
        processed++;
        const discordId = String(row.user_discord_id);
        let member;
        try {
          member = await interaction.guild.members.fetch(discordId);
        } catch {
          skipped++;
          continue;
        }
        const targetRoleId = row.target_role_id ? String(row.target_role_id) : null;
        if (!targetRoleId) {
          skippedNoMapping++;
        }
        const currentRoleIds = new Set(member.roles.cache.map(r => r.id));

        // Remove exclusive roles (from roles table) except the target
        const toRemove = [];
        for (const rid of currentRoleIds) {
          if (nonMultiSet.has(String(rid)) && String(rid) !== String(targetRoleId)) {
            toRemove.push(rid);
          }
        }
        if (toRemove.length) {
          try { await member.roles.remove(toRemove); removed += toRemove.length; } catch {}
        }

        // Add target role if needed
        if (targetRoleId && !currentRoleIds.has(targetRoleId)) {
          const roleObj = interaction.guild.roles.cache.get(targetRoleId);
          if (roleObj) {
            try { await member.roles.add(roleObj); applied++; } catch {}
          } else {
            skippedRoleNotFound++;
          }
        }
      }

      const msg = [
        'Applied roles based on primary character ranks:',
        `Processed users: ${processed}`,
        `Roles added: ${applied}`,
        `Exclusive roles removed: ${removed}`,
        `Skipped (not in guild): ${skipped}`,
        `Skipped (no rank->role mapping): ${skippedNoMapping}`,
        `Skipped (role id not found in guild): ${skippedRoleNotFound}`
      ].join('\n');
      return interaction.editReply({ content: msg });
    } catch (e) {
      console.error('apply roles error:', e);
      return interaction.editReply({ content: 'Failed to apply roles.' });
    }
  }

  if (id === 'fc_admin_sync_roles') {
    // Permission check
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) {
      return interaction.reply({ content: 'You need Manage Server permission to sync roles.', ephemeral: true });
    }
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      await interaction.guild.roles.fetch();
      const roles = interaction.guild.roles.cache;
      const pool = await getPool();
      let upserts = 0;
      for (const role of roles.values()) {
        if (role.id === interaction.guild.id) continue; // skip @everyone
        const name = role.name || `role_${role.id}`;
        await pool.query(
          'INSERT INTO roles (discord_role_id, guild_id, role_name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role_name = VALUES(role_name), guild_id = VALUES(guild_id)',
          [role.id, interaction.guild.id, name]
        );
        upserts++;
      }
      return interaction.editReply({ content: `Synced ${upserts} roles from this server into the database.` });
    } catch (e) {
      console.error('sync roles error:', e);
      return interaction.editReply({ content: 'Failed to sync roles.' });
    }
  }

  if (id === 'fc_register_user') {
    const pfp = typeof interaction.user.displayAvatarURL === 'function' ? interaction.user.displayAvatarURL() : null;
    await ensureUserByDiscordId(
      interaction.user.id,
      interaction.user.username,
      interaction.user.globalName || interaction.user.displayName || interaction.user.username,
      pfp
    );
    return refreshPanel(interaction, appConfig);
  }

  if (id === 'fc_remove_user') {
    await removeUserByDiscordId(interaction.user.id);
    return refreshPanel(interaction, appConfig);
  }

  if (id === 'fc_claim_daily') {
    const user = await getUserByDiscordId(interaction.user.id);
    if (!user) {
      return interaction.reply({ content: 'You must register first.', ephemeral: true });
    }
    const amtMember = Number(appConfig.Currency_Daily_Reward_Members ?? appConfig.Currency_Daily_Reward ?? 100);
    const amtDefault = Number(appConfig.Currency_Daily_Reward ?? 100);
    const amount = user.is_member ? amtMember : amtDefault;
    const currency = String(appConfig.Currency_Name ?? 'Gil');
    const result = await claimDaily(interaction.user, amount, currency);
    if (!result.claimed) {
      await interaction.reply({ content: 'You already claimed your daily today. Come back tomorrow!', ephemeral: true });
    } else {
      await interaction.reply({ content: `Daily claimed! +${amount} ${currency}. New balance: ${result.balance}`, ephemeral: true });
    }
    return;
  }

  if (id === 'fc_register_character') {
    const user = await getUserByDiscordId(interaction.user.id);
    if (!user) return interaction.reply({ content: 'You must register first.', ephemeral: true });

    const modal = new ModalBuilder()
      .setCustomId('fc_modal_register_character')
      .setTitle('Register Character');

    const input = new TextInputBuilder()
      .setCustomId('lodestone_id')
      .setLabel('Lodestone ID')
      .setPlaceholder('e.g., 1234567890123456789')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(input);
    modal.addComponents(row);
    return interaction.showModal(modal);
  }

  if (id === 'fc_manage_characters') {
    const panel = await buildManageCharactersPanel({ discordUser: interaction.user, page: 1 });
    return interaction.reply({ content: panel.content, embeds: panel.embeds, components: panel.components, ephemeral: true });
  }

  // Pagination: Previous / Next
  const prevMatch = id.match(/^fc_chars_prev_(\d+)$/);
  if (prevMatch) {
    const current = parseInt(prevMatch[1], 10) || 1;
    const page = Math.max(1, current - 1);
    const panel = await buildManageCharactersPanel({ discordUser: interaction.user, page });
    return interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  }

  const nextMatch = id.match(/^fc_chars_next_(\d+)$/);
  if (nextMatch) {
    const current = parseInt(nextMatch[1], 10) || 1;
    const all = await listCharactersByDiscordId(interaction.user.id);
    const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const page = Math.min(totalPages, current + 1);
    const panel = await buildManageCharactersPanel({ discordUser: interaction.user, page });
    return interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  }

  // Edit button: fc_chars_edit_{n}_{page}
  const editMatch = id.match(/^fc_chars_edit_(\d+)_(\d+)$/);
  if (editMatch) {
    const n = parseInt(editMatch[1], 10) || 1;
    const page = parseInt(editMatch[2], 10) || 1;
    const all = await listCharactersByDiscordId(interaction.user.id);
    const start = (page - 1) * PAGE_SIZE;
    const index = start + (n - 1);
    const selected = all[index];
    if (!selected) {
      return interaction.reply({ content: 'Character not found for this page.', ephemeral: true });
    }
    const panel = buildEditCharacterPanel({ character: selected });
    // For ephemeral interaction, reply a new ephemeral message
    return interaction.reply({ content: panel.content, embeds: panel.embeds, components: panel.components, ephemeral: true });
  }

  // Edit panel buttons: primary toggle, sync, delete
  const primaryMatch = id.match(/^fc_char_primary_(\d+)$/);
  if (primaryMatch) {
    const lodestoneId = primaryMatch[1];
    const all = await listCharactersByDiscordId(interaction.user.id);
    const selected = all.find(c => String(c.lodestone_id) === String(lodestoneId));
    if (!selected) return interaction.reply({ content: 'Character not found.', ephemeral: true });
    if (selected.is_primary) {
      await unsetPrimaryByLodestone(interaction.user.id, lodestoneId);
    } else {
      await setPrimaryByLodestone(interaction.user.id, lodestoneId);
    }
    const refreshedAll = await listCharactersByDiscordId(interaction.user.id);
    const updated = refreshedAll.find(c => String(c.lodestone_id) === String(lodestoneId));
    const panel = buildEditCharacterPanel({ character: updated || selected });
    return interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  }

  const syncMatch = id.match(/^fc_char_sync_(\d+)$/);
  if (syncMatch) {
    const lodestoneId = syncMatch[1];
    const result = await syncCharacterNameByLodestone(lodestoneId);
    if (!result.ok) {
      return interaction.reply({ content: 'Failed to sync character name from Lodestone.', ephemeral: true });
    }
    const all = await listCharactersByDiscordId(interaction.user.id);
    const updated = all.find(c => String(c.lodestone_id) === String(lodestoneId));
    const panel = buildEditCharacterPanel({ character: updated || { lodestone_id: lodestoneId, character_name: result.name, is_primary: 0 } });
    return interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  }

  const delMatch = id.match(/^fc_char_delete_(\d+)$/);
  if (delMatch) {
    const lodestoneId = delMatch[1];
    const del = await deleteCharacterByLodestone(interaction.user.id, lodestoneId);
    if (!del.ok) return interaction.reply({ content: 'Character not found or could not be deleted.', ephemeral: true });
    // After delete, go back to manage characters page 1
    const panel = await buildManageCharactersPanel({ discordUser: interaction.user, page: 1 });
    return interaction.update({ content: panel.content, embeds: panel.embeds, components: panel.components });
  }
}

module.exports = { handleButton };
