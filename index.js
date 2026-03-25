const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3').verbose();
const { Client, Collection, Events, GatewayIntentBits } = require('discord.js');
const token = process.env.DISCORD_TOKEN;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ],
    partials: ['CHANNEL']
});

//simple web server added so it can be deployed on render without it being gutted for inactivity
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot is currently working");
});

app.listen(PORT, () => {
  console.log(`Web server running on port ${PORT}`);
});

//allocating memory for commands and command cooldowns
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

//waiting for the bot to login and is ready to operate
client.once(Events.ClientReady, async c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    client.user.setActivity('quotes..', { type: 'LISTENING' });
        await new Promise(resolve => setTimeout(resolve, 3000));

        //id of the #quotes channel 
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

//takes discord token as env
client.login(process.env.DISCORD_TOKEN);

//handling slash commands and their cooldowns
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
        } 
        else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

// initializing database and tables
const db = new sqlite3.Database('./quotesv2.db', err => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS quotes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quote TEXT NOT NULL,
                author TEXT NOT NULL,
                date TEXT NOT NULL,
                poster TEXT
            )`, err => {
                if (err) {
                    console.error('Error creating table:', err.message);
                } 
                else {
                    console.log('Quotes table ready.');
                }
            });

            db.run(`CREATE TABLE IF NOT EXISTS quote_usage (
                quote_id INTEGER NOT NULL,
                command TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (quote_id, command),
                FOREIGN KEY (quote_id) REFERENCES quotes(id)
            )`, err => {
                if (err) {
                    console.error('Error creating usage table:', err.message);
                } else {
                    console.log('Quote usage table ready.');
                }
            });
        });
    }
});

//function to increment quote usage for stats command
function incrementQuoteUsage(dbInstance, quoteId, command) {
    if (!quoteId || !command) return;

    dbInstance.run(
        'INSERT OR IGNORE INTO quote_usage (quote_id, command, count) VALUES (?, ?, 0)',
        [quoteId, command],
        err => {
            if (err) {
                console.error('Error initializing quote usage:', err.message);
                return;
            }
            dbInstance.run(
                'UPDATE quote_usage SET count = count + 1 WHERE quote_id = ? AND command = ?',
                [quoteId, command],
                updateErr => {
                    if (updateErr) {
                        console.error('Error updating quote usage:', updateErr.message);
                    }
                },
            );
        },
    );
}

//message response for !quote command which fetches a quote
client.on('messageCreate', message => {
    // Ignore bot messages
    if (message.author.bot) return;

    if (message.content === '!quote') {
        const dbInstance = new sqlite3.Database('./quotesv2.db');
        dbInstance.get(
            'SELECT id, quote, author, date, poster FROM quotes ORDER BY RANDOM() LIMIT 1', 
            (err, row) => {
                if (err) {
                    console.error('Error fetching quote:', err.message);
                    message.channel.send("There was an error fetching the quote.");
                } else if (row) {
                    incrementQuoteUsage(dbInstance, row.id, 'quote');
                    const poster = row.poster || "Unknown";
                    message.channel.send(
                        `"${row.quote}" - ${row.author} (${row.date})\n*Posted by:* ${poster}`
                    );
                } 
                else {
                    message.channel.send("No quotes found in the database.");
                }
                dbInstance.close();
            }
        );
    }
      
        //response for the command !guess
        if (message.content === '!guess') {
            const dbInstance = new sqlite3.Database('./quotesv2.db');
            dbInstance.get('SELECT id, quote, author, date, poster FROM quotes ORDER BY RANDOM() LIMIT 1', async (err, row) => {
                if (err) {
                    console.error('Error fetching quote:', err.message);
                    dbInstance.close();
                    return;
                }
                if (row) {
                    incrementQuoteUsage(dbInstance, row.id, 'guess');
                    await message.channel.send(`Guess the author for this quote:\n\n"${row.quote}"`);

                    const poster = row.poster || "Unknown";
                    const filter = m => m.author.id === message.author.id;
                    try {
                        await message.channel.awaitMessages({ filter, max: 1, time: 45000, errors: ['time'] });
                        await message.channel.send(`The correct answer is: ${row.author})\n*Posted by:* ${poster}`);
                    } catch (error) {
                        await message.channel.send(`Time is up! The correct answer is: ${row.author}`);
                    }
                } 
                else {
                    await message.channel.send('No quotes found in the database.');
                }
                dbInstance.close();
            });
        }

        // command !searchquote
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
                    } 
                    else {
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

        // command !stats
        if (message.content === '!stats') {
            const dbInstance = new sqlite3.Database('./quotesv2.db');

            const totalsQuery = `
                SELECT command, SUM(count) AS total
                FROM quote_usage
                GROUP BY command
            `;

            const topOverallQuery = `
                SELECT q.quote, q.author, q.date, SUM(u.count) AS total
                FROM quote_usage u
                JOIN quotes q ON q.id = u.quote_id
                GROUP BY u.quote_id
                ORDER BY total DESC
                LIMIT 10
            `;

            dbInstance.all(totalsQuery, (totalsErr, totalsRows) => {
                if (totalsErr) {
                    console.error('Error fetching stats totals:', totalsErr.message);
                    message.channel.send('There was an error fetching stats.');
                    dbInstance.close();
                    return;
                }

                const totals = new Map();
                (totalsRows || []).forEach(r => totals.set(r.command, r.total ?? 0));
                const quoteTotal = totals.get('quote') ?? 0;
                const guessTotal = totals.get('guess') ?? 0;

                dbInstance.all(topOverallQuery, (topErr, topRows) => {
                    if (topErr) {
                        console.error('Error fetching top overall stats:', topErr.message);
                        message.channel.send('There was an error fetching stats.');
                        dbInstance.close();
                        return;
                    }

                    let response = `**Stats**\n`;
                    response += `Total served via !quote: **${quoteTotal}**\n`;
                    response += `Total served via !guess: **${guessTotal}**\n`;

                    if (topRows?.length) {
                        response += `\n**Top quotes (overall)**\n`;
                        topRows.forEach((row, index) => {
                            const servedCount = row.total ?? 0;
                            response += `**${index + 1}.** "${row.quote}" - ${row.author} (${row.date}) — served **${servedCount}** time(s)\n`;
                        });
                    } else {
                        response += `\nNo quote usage recorded yet.\n`;
                    }

                    message.channel.send(response);
                    dbInstance.close();
                });
            });
        }
});
    