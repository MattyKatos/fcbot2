const { getBalance } = require('../services/economy');

module.exports = {
  name: 'balance',
  aliases: ['bal'],
  description: 'Show your current currency balance',
  async execute({ message, config }) {
    try {
      const currency = String(config?.Currency_Name ?? 'Gil');
      const balance = await getBalance(message.author.id);
      await message.reply(`Your balance is ${balance} ${currency}.`);
    } catch (err) {
      console.error('balance command error:', err);
      await message.reply('There was an error fetching your balance.');
    }
  }
};
