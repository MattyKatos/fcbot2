const { PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { ensureUserByDiscordId } = require('../services/db-helpers');
const { registerCharacter, registerCharacterForUserId } = require('../services/characters');
const { buildFcPanel } = require('../ui/fc');
const { scrapeCharacterName } = require('../scraper');
const { addLog } = require('../services/logs');
const { getPool } = require('../db');

async function handleModal(interaction, appConfig) {
  if (!interaction.isModalSubmit()) return;
  const id = interaction.customId;

  if (id === 'fc_modal_register_character') {
    const lodestone = interaction.fields.getTextInputValue('lodestone_id')?.trim();
    if (!lodestone || !/^\d{5,20}$/.test(lodestone)) {
      return interaction.reply({ content: 'Please enter a valid numeric Lodestone ID.', ephemeral: true });
    }

    try {
      // Scrape character name from Lodestone
      let scrapedName = null;
      try {
        const { name } = await scrapeCharacterName(lodestone);
        scrapedName = name || null;
      } catch (e) {
        // Non-fatal; proceed without name
        scrapedName = null;
      }

      const result = await registerCharacter(interaction.user, lodestone, scrapedName);
      if (!result.created && result.reason === 'exists') {
        return interaction.reply({ content: `Character ${lodestone} is already registered.`, ephemeral: true });
      }
      const panel = await buildFcPanel({ discordUser: interaction.user, config: appConfig });
      return interaction.reply({
        content: `Character ${lodestone}${scrapedName ? ` (${scrapedName})` : ''} registered successfully.`,
        embeds: panel.embeds,
        components: panel.components,
        ephemeral: true
      });
    } catch (e) {
      console.error('register character modal error:', e);
      return interaction.reply({ content: 'There was an error registering that character.', ephemeral: true });
    }
  }

  // Admin: Register Character for target user
  const adminReg = id.match(/^fc_admin_modal_register_character_(\d+)$/);
  if (adminReg) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetUserId = parseInt(adminReg[1], 10);
    const lodestone = interaction.fields.getTextInputValue('lodestone_id')?.trim();
    if (!lodestone || !/^\d{5,20}$/.test(lodestone)) {
      return interaction.reply({ content: 'Please enter a valid numeric Lodestone ID.', ephemeral: true });
    }
    try {
      let scrapedName = null;
      try {
        const { name } = await scrapeCharacterName(lodestone);
        scrapedName = name || null;
      } catch {}
      const pool = await getPool();
      const [[u]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [targetUserId]);
      if (!u) return interaction.reply({ content: 'User not found.', ephemeral: true });
      const result = await registerCharacterForUserId(u.user_id, lodestone, scrapedName);
      if (!result.created && result.reason === 'exists') {
        return interaction.reply({ content: `Character ${lodestone} is already registered.`, ephemeral: true });
      }
      const who = u.display_name || u.user_name || u.user_discord_id;
      return interaction.reply({ content: `Registered character ${lodestone}${scrapedName ? ` (${scrapedName})` : ''} for ${who} (ID: ${u.user_discord_id}).`, ephemeral: true });
    } catch (e) {
      console.error('admin register character modal error:', e);
      return interaction.reply({ content: 'There was an error registering that character for the user.', ephemeral: true });
    }
  }

  // Admin: Add Currency
  const adminAdd = id.match(/^fc_admin_modal_add_cur_(\d+)$/);
  if (adminAdd) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetUserId = parseInt(adminAdd[1], 10);
    const amtStr = interaction.fields.getTextInputValue('amount')?.trim();
    const amount = Number(amtStr);
    if (!Number.isFinite(amount) || amount <= 0) return interaction.reply({ content: 'Amount must be a positive number.', ephemeral: true });
    const pool = await getPool();
    const [[u]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [targetUserId]);
    if (!u) return interaction.reply({ content: 'User not found.', ephemeral: true });
    await pool.query('UPDATE users SET currency = currency + ? WHERE user_id = ?', [amount, u.user_id]);
    await addLog({ user_id: u.user_id, log_type: 'currency', log_description: `Admin added +${amount} ${appConfig.Currency_Name || 'Currency'}` });
    const [[nu]] = await pool.query('SELECT currency FROM users WHERE user_id = ?', [u.user_id]);
    const who = u.display_name || u.user_name || u.user_discord_id;
    return interaction.reply({ content: `Added +${amount} ${appConfig.Currency_Name || 'Currency'} to ${who} (ID: ${u.user_discord_id}). New balance: ${nu.currency}`, ephemeral: true });
  }

  // Admin: Take Currency
  const adminTake = id.match(/^fc_admin_modal_take_cur_(\d+)$/);
  if (adminTake) {
    const hasPerm = interaction.inGuild() && interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageGuild);
    if (!hasPerm) return interaction.reply({ content: 'Missing permission.', ephemeral: true });
    const targetUserId = parseInt(adminTake[1], 10);
    const amtStr = interaction.fields.getTextInputValue('amount')?.trim();
    const amount = Number(amtStr);
    if (!Number.isFinite(amount) || amount <= 0) return interaction.reply({ content: 'Amount must be a positive number.', ephemeral: true });
    const pool = await getPool();
    const [[u]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [targetUserId]);
    if (!u) return interaction.reply({ content: 'User not found.', ephemeral: true });
    await pool.query('UPDATE users SET currency = GREATEST(currency - ?, 0) WHERE user_id = ?', [amount, u.user_id]);
    await addLog({ user_id: u.user_id, log_type: 'currency', log_description: `Admin took -${amount} ${appConfig.Currency_Name || 'Currency'}` });
    const [[nu]] = await pool.query('SELECT currency FROM users WHERE user_id = ?', [u.user_id]);
    const who = u.display_name || u.user_name || u.user_discord_id;
    return interaction.reply({ content: `Took -${amount} ${appConfig.Currency_Name || 'Currency'} from ${who} (ID: ${u.user_discord_id}). New balance: ${nu.currency}`, ephemeral: true });
  }

  // /fcuser: Give Currency modal submit (transfer from submitter to target)
  const userGive = id.match(/^fc_user_modal_give_cur_(\d+)$/);
  if (userGive) {
    const targetDiscordId = userGive[1];
    const amtStr = interaction.fields.getTextInputValue('amount')?.trim();
    const amount = Number(amtStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      return interaction.reply({ content: 'Amount must be a positive number.', ephemeral: true });
    }
    try {
      const pool = await getPool();
      // Ensure both users exist
      const giver = await ensureUserByDiscordId(
        interaction.user.id,
        interaction.user.username,
        interaction.user.globalName || interaction.user.displayName || interaction.user.username,
        typeof interaction.user.displayAvatarURL === 'function' ? interaction.user.displayAvatarURL() : null
      );
      const [[receiver]] = await pool.query('SELECT * FROM users WHERE user_discord_id = ?', [targetDiscordId]);
      if (!receiver) {
        return interaction.reply({ content: 'Target user is not registered.', ephemeral: true });
      }
      // Verify giver has enough funds
      if (Number(giver.currency) < amount) {
        return interaction.reply({ content: `You do not have enough ${appConfig.Currency_Name || 'Currency'} to give.`, ephemeral: true });
      }
      // Perform transfer atomically
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('UPDATE users SET currency = currency - ? WHERE user_id = ?', [amount, giver.user_id]);
        await conn.query('UPDATE users SET currency = currency + ? WHERE user_id = ?', [amount, receiver.user_id]);
        await conn.commit();
      } catch (e) {
        try { await conn.rollback(); } catch {}
        throw e;
      } finally {
        conn.release();
      }
      await addLog({ user_id: giver.user_id, log_type: 'currency', log_description: `Gave -${amount} ${appConfig.Currency_Name || 'Currency'} to <@${targetDiscordId}>` });
      await addLog({ user_id: receiver.user_id, log_type: 'currency', log_description: `Received +${amount} ${appConfig.Currency_Name || 'Currency'} from <@${interaction.user.id}>` });
      // Public confirmation (not ephemeral), mention both
      return interaction.reply({
        content: `<@${interaction.user.id}> gave ${amount} ${appConfig.Currency_Name || 'Currency'} to <@${targetDiscordId}>!`,
        ephemeral: false
      });
    } catch (e) {
      console.error('give currency modal error:', e);
      return interaction.reply({ content: 'Failed to transfer currency.', ephemeral: true });
    }
  }

  // /fcuser: Deathroll bet modal submit -> create challenge, deduct challenger bet, announce
  const dr = id.match(/^fc_user_modal_deathroll_(\d+)$/);
  if (dr) {
    const targetDiscordId = dr[1];
    const amtStr = interaction.fields.getTextInputValue('amount')?.trim();
    const amount = Number(amtStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      return interaction.reply({ content: 'Bet must be a positive number.', ephemeral: true });
    }
    try {
      const pool = await getPool();
      // Ensure challenger exists and has funds
      const challenger = await ensureUserByDiscordId(
        interaction.user.id,
        interaction.user.username,
        interaction.user.globalName || interaction.user.displayName || interaction.user.username,
        typeof interaction.user.displayAvatarURL === 'function' ? interaction.user.displayAvatarURL() : null
      );
      if (Number(challenger.currency) < amount) {
        return interaction.reply({ content: `You do not have enough ${appConfig.Currency_Name || 'Currency'} to place that bet.`, ephemeral: true });
      }
      const [[receiver]] = await pool.query('SELECT * FROM users WHERE user_discord_id = ?', [targetDiscordId]);
      if (!receiver) {
        return interaction.reply({ content: 'Target user is not registered.', ephemeral: true });
      }
      // Create challenge and deduct bet inside a transaction
      const conn = await pool.getConnection();
      let gambaId;
      try {
        await conn.beginTransaction();
        const [ins] = await conn.query(
          'INSERT INTO gamba (gamba_user_id, gamba_challenger_id, gamba_type, gamba_bet, gamba_status, gamba_payload) VALUES (?, ?, ?, ?, ?, NULL)',
          [receiver.user_id, challenger.user_id, 'deathroll', amount, 'pending']
        );
        gambaId = ins.insertId;
        await conn.query('UPDATE users SET currency = currency - ? WHERE user_id = ?', [amount, challenger.user_id]);
        await conn.commit();
      } catch (e) {
        try { await conn.rollback(); } catch {}
        throw e;
      } finally {
        conn.release();
      }
      // Announce challenge publicly with Accept/Cancel buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`gamba_accept_${gambaId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`gamba_cancel_${gambaId}`).setLabel('Decline/Cancel').setStyle(ButtonStyle.Danger)
      );
      return interaction.reply({
        content: `<@${interaction.user.id}> has challenged <@${targetDiscordId}> to a Deathroll for ${amount} ${appConfig.Currency_Name || 'Currency'}!`,
        components: [row],
        ephemeral: false
      });
    } catch (e) {
      console.error('deathroll create error:', e);
      return interaction.reply({ content: 'Failed to create the deathroll challenge.', ephemeral: true });
    }
  }
}

module.exports = { handleModal };
