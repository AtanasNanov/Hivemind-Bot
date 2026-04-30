const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
	category: 'utility',
	data: new SlashCommandBuilder()
		.setName('help')
		.setDescription('Provides a list of available commands.'),
	async execute(interaction) {
		const embed = new EmbedBuilder()
			.setTitle('Available Commands')
			.setColor(0x5865F2)
			.addFields(
				{
					name: 'Slash Commands',
					value: '`/help` — Shows this help message\n`/yt` — YouTube channel link\n`/reload` — Reloads a command',
				},
				{
					name: 'Prefix Commands',
					value: '`!quote` — Fetch a random quote\n`!guess` — Guess the author of a quote\n`!searchquote <term>` — Search for quotes by text or author\n`!stats` — Show quote usage statistics',
				},
			);
		await interaction.reply({ embeds: [embed] });
	},
};