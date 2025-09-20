module.exports = {
  name: 'ping',
  aliases: [],
  description: 'Health check command',
  async execute({ message }) {
    const sent = await message.reply('Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    await sent.edit(`Pong! ${latency}ms`);
  }
};
