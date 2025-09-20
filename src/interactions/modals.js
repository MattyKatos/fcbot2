const { PermissionsBitField } = require('discord.js');
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
}

module.exports = { handleModal };
