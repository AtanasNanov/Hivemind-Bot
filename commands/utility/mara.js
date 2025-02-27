const { SlashCommandBuilder } = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('mara')
		.setDescription('Replies with maraba'),
	async execute(interaction) {
		await interaction.reply('maraba');
	},
};