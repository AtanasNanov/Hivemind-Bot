const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('Provides a list of available commands.'),
	async execute(interaction) {
		await interaction.reply('Here are the available commands: !quote, !guess, !searchquote, !stats, /yt');
	},
};