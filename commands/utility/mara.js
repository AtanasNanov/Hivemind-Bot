const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('yt')
		.setDescription('YouTube channel link.'),
	async execute(interaction) {
		await interaction.reply('https://www.youtube.com/channel/UCgd6GZOm-mTwDViMvfb5zyA');
	},
};