const { claimDaily } = require('../services/economy');

module.exports = {
  name: 'daily',
  aliases: [],
  description: 'Claim your daily currency reward',
  async execute({ message, config }) {
    const amount = Number(config?.Currency_Daily_Reward ?? 100);
    const currency = String(config?.Currency_Name ?? 'Gil');
    try {
      const result = await claimDaily(message.author, amount, currency);
      if (!result.claimed) {
        return void message.reply('You already claimed your daily today. Come back tomorrow!');
      }
      return void message.reply(`Daily claimed! +${amount} ${currency}. New balance: ${result.balance} (streak: ${result.streak_current}, longest: ${result.streak_longest})`);
    } catch (err) {
      console.error('daily command error:', err);
      return void message.reply('There was an error claiming your daily.');
    }
  }
};
