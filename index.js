const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const { token } = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ],
    partials: ['CHANNEL']
});


client.cooldowns = new Collection();
client.commands = new Collection();

const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    }
}

client.once(Events.ClientReady, async c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    client.user.setActivity('quotes..', { type: 'LISTENING' });
        await new Promise(resolve => setTimeout(resolve, 3000));
    
        const channelId = '478595163376320553'; 
        try {
            const channel = await client.channels.fetch(channelId, { force: true });
            if (!channel) {
                console.error('Channel not found. Please double-check the channel ID.');
                return;
            }
            console.log("Fetched channel:", channel.name, channel.id, channel.type);
            if (!channel.isTextBased()) {
                return console.error('Channel is not a text channel');
            }
            
            let lastMessageId;
            const fetchMessages = async () => {
                const options = { limit: 100 };
                if (lastMessageId) options.before = lastMessageId;
                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) return db.close();
                messages.forEach(message => {
                    const match = message.content.match(/^(.*?)\s*-\s*(.*?)\s*\((\d{2}\/\d{2}\/\d{2,4})\)$/);
                    if (match) {
                        const [quote, author, date] = [match[1].trim(), match[2].trim(), match[3].trim()];
                        const poster = message.author.tag;
                        db.run(
                            'INSERT INTO quotes (quote, author, date, poster) VALUES (?, ?, ?, ?)', 
                            [quote, author, date, poster]
                        );
                    }
                });
                lastMessageId = messages.last().id;
                fetchMessages();    
            };
            fetchMessages();
        } catch (error) {
            console.error('Error fetching the channel:', error);
        }
});

client.login(token);

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    if (!client.cooldowns.has(command.data.name)) {
        client.cooldowns.set(command.data.name, new Collection());
    }

    const now = Date.now();
    const timestamps = client.cooldowns.get(command.data.name);
    const cooldownAmount = ((command.cooldown ?? 3) * 1000);

    if (timestamps.has(interaction.user.id)) {
        const expirationTime = timestamps.get(interaction.user.id) + cooldownAmount;
        if (now < expirationTime) {
            const expiredTimestamp = Math.round(expirationTime / 1000);
            return interaction.reply({
                content: `Please wait, you are on cooldown for \`${command.data.name}\`. You can use it again <t:${expiredTimestamp}:R>.`,
                ephemeral: true
            });
        }
    }
    timestamps.set(interaction.user.id, now);
    setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

const db = new sqlite3.Database('./quotesv2.db', err => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.run(`CREATE TABLE IF NOT EXISTS quotes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            quote TEXT NOT NULL,
            author TEXT NOT NULL,
            date TEXT NOT NULL,
            poster TEXT
        )`, err => {
            if (err) {
                console.error('Error creating table:', err.message);
            } else {
                console.log('Quotes table ready.');
            }
        });
    }
});

client.on('messageCreate', message => {
    if (message.content === '!quote') {
        const dbInstance = new sqlite3.Database('./quotesv2.db');
        dbInstance.get(
            'SELECT quote, author, date, poster FROM quotes ORDER BY RANDOM() LIMIT 1', 
            (err, row) => {
                if (err) {
                    console.error('Error fetching quote:', err.message);
                    message.channel.send("There was an error fetching the quote.");
                } else if (row) {
                    const poster = row.poster || "Unknown";
                    message.channel.send(
                        `"${row.quote}" - ${row.author} (${row.date})\n*Posted by:* ${poster}`
                    );
                } else {
                    message.channel.send("No quotes found in the database.");
                }
                dbInstance.close();
            }
        );
    }
        // Ignore bot messages
        if (message.author.bot) return;
      
        if (message.content === '!guess') {
            const dbInstance = new sqlite3.Database('./quotesv2.db');
            dbInstance.get('SELECT quote, author, date FROM quotes ORDER BY RANDOM() LIMIT 1', async (err, row) => {
                if (err) {
                    console.error('Error fetching quote:', err.message);
                    dbInstance.close();
                    return;
                }
                if (row) {
                    await message.channel.send(`Guess the author for this quote:\n\n"${row.quote}"`);
                
                    const filter = m => m.author.id === message.author.id;
                    try {
                        await message.channel.awaitMessages({ filter, max: 1, time: 45000, errors: ['time'] });
                        await message.channel.send(`The correct answer is: ${row.author}`);
                    } catch (error) {
                        await message.channel.send(`Time is up! The correct answer is: ${row.author}`);
                    }
                } else {
                    await message.channel.send('No quotes found in the database.');
                }
                dbInstance.close();
            });
        }
        if (message.content.startsWith('!searchquote')) {

            const args = message.content.split(' ').slice(1);
            if (!args.length) {
                return message.channel.send("Please provide a search term. Usage: `!searchquote your term`");
            }
            const searchTerm = args.join(' ');
            const dbInstance = new sqlite3.Database('./quotesv2.db');
            const query = `
                SELECT quote, author, date 
                FROM quotes 
                WHERE quote LIKE ? OR author LIKE ? 
                LIMIT 20
            `;
            const likeTerm = `%${searchTerm}%`;
    
            dbInstance.all(query, [likeTerm, likeTerm], (err, rows) => {
                if (err) {
                    console.error('Error searching quotes:', err.message);
                    message.channel.send("There was an error while searching quotes.");
                } else {
                    if (rows.length === 0) {
                        message.channel.send(`No quotes found matching "${searchTerm}".`);
                    } else {
                        let response = `Found ${rows.length} quote(s):\n`;
                        rows.forEach((row, index) => {
                            response += `**${index + 1}.** "${row.quote}" - ${row.author} (${row.date})\n`;
                        });
                        message.channel.send(response);
                    }
                }
                dbInstance.close();
            });
        }
});
