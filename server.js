const express = require('express');
const helmet = require('helmet');
const validator = require('validator');
const xss = require('xss');
const mongoose = require('mongoose');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const Game = require('./models/Game');
const User = require('./models/User');
const Contribution = require('./models/Contribution');
const { verifyKeyMiddleware, InteractionType, InteractionResponseType } = require('discord-interactions');
require('dotenv').config();

const app = express();

// Serverless-optimized MongoDB connection
if (mongoose.connection.readyState === 0) {
    mongoose.connect(process.env.MONGODB_URI).then(() => {
        console.log("Connected to MongoDB Atlas");
    }).catch((err) => {
        console.error("Database connection error:", err);
    });
}

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Let Vercel handle edge security, prevent blocking our own assets
    crossOriginEmbedderPolicy: false
}));

// Input validation
const validateInput = {
    sanitizeString: (str) => xss(validator.escape(str || '')),
    isValidSearch: (term) => validator.isLength(term || '', { min: 1, max: 100 })
};

// Helper to check if a game has extended data for sorting
const hasGameData = (game) => {
    return !!(game.overview_text || (game.guides && game.guides.length) || (game.assets && game.assets.length) || (game.communities && game.communities.length) || (game.mods && game.mods.length) || game.trailer_id || game.ratings);
};
// Helper to strip empty arrays so the frontend properly grays out inactive games
const cleanEmptyArrays = (game) => {
    if (game.guides && game.guides.length === 0) delete game.guides;
    if (game.assets && game.assets.length === 0) delete game.assets;
    if (game.communities && game.communities.length === 0) delete game.communities;
    if (game.mods && game.mods.length === 0) delete game.mods;
    if (game.mini_focuses && game.mini_focuses.length === 0) delete game.mini_focuses;
    return game;
};
// --- API ROUTES ---

app.get('/api/games', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const startIndex = (page - 1) * limit;

    try {
        const allGames = await Game.find({}).lean();
        
        // Retain original sorting logic: prioritized games with populated data, then alphabetical
        allGames.sort((a, b) => {
            const aData = hasGameData(a);
            const bData = hasGameData(b);
            if (aData && !bData) return -1;
            if (!aData && bData) return 1;
            return a.name.localeCompare(b.name);
        });

        const paginatedGames = allGames.slice(startIndex, startIndex + limit).map(cleanEmptyArrays);

        res.json({
            games: paginatedGames,
            pagination: {
                page,
                limit,
                total: allGames.length,
                pages: Math.ceil(allGames.length / limit)
            }
        });
    } catch (err) {
        console.error("Failed to fetch games:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get('/api/games/:id', async (req, res) => {
    try {
        const game = await Game.findOne({ id: req.params.id }).lean();
        if (!game) return res.status(404).json({ error: 'Game not found' });
        res.json(game);
    } catch (err) {
        console.error("Failed to fetch game:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get('/api/games/search/:term', async (req, res) => {
    const searchTerm = req.params.term;
    if (!validateInput.isValidSearch(searchTerm)) {
        return res.status(400).json({ error: 'Invalid search term' });
    }
    const sanitizedTerm = validateInput.sanitizeString(searchTerm);
    
    try {
        const results = await Game.find({
            $or: [
                { name: { $regex: sanitizedTerm,$options: 'i' } },
                { developer: { $regex: sanitizedTerm,$options: 'i' } }
            ]
        }).limit(10).lean();
        res.json(results.map(cleanEmptyArrays));
    } catch (err) {
        console.error("Search error:", err);
        res.status(500).json({ error: "Database error" });
    }
});

// --- DISCORD INTERACTIONS ROUTES ---
// NOTE: This route MUST use verifyKeyMiddleware before parsing the body
app.post('/api/interactions', verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY), async (req, res) => {
    const interaction = req.body;

    // Handle Discord's mandatory security ping
    if (interaction.type === InteractionType.PING) {
        return res.send({ type: InteractionResponseType.PONG });
    }

    // Handle Button Clicks
    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
        const customId = interaction.data.custom_id; // e.g., "approve_12345"
        const [action, contributionId] = customId.split('_');

        try {
            const contribution = await Contribution.findById(contributionId);
            if (!contribution) {
                return res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: "Error: Contribution not found in database.", flags: 64 } // Ephemeral
                });
            }

            if (action === 'approve') {
                // TODO: Migrate draft data to the Game document and update User points

                // Update the Discord message to show it was approved
                return res.send({
                    type: InteractionResponseType.UPDATE_MESSAGE,
                    data: {
                        content: `✅ **Approved by <@${interaction.member.user.id}>**`,
                        components: [] // Removes the buttons
                    }
                });
            }

            if (action === 'deny') {
                contribution.status = 'rejected';
                await contribution.save();

                return res.send({
                    type: InteractionResponseType.UPDATE_MESSAGE,
                    data: {
                        content: `❌ **Denied by <@${interaction.member.user.id}>**`,
                        components: []
                    }
                });
            }

            if (action === 'tweak') {
                // Pops up a text input modal right inside Discord for the admin to edit
                return res.send({
                    type: InteractionResponseType.MODAL,
                    data: {
                        custom_id: `modal_tweak_${contributionId}`,
                        title: "Tweak Contribution",
                        components: [{
                            type: 1,
                            components: [{
                                type: 4,
                                custom_id: "tweaked_data",
                                label: "Edit the submission JSON:",
                                style: 2,
                                min_length: 1,
                                max_length: 4000,
                                value: JSON.stringify(contribution.data, null, 2),
                                required: true
                            }]
                        }]
                    }
                });
            }
        } catch (err) {
            console.error("Interaction error:", err);
        }
    }

    // Handle Modal Submissions (from the Tweak button)
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
        const customId = interaction.data.custom_id;
        
        if (customId.startsWith('modal_tweak_')) {
            const contributionId = customId.split('_')[2];
            const newJsonData = interaction.data.components[0].components[0].value;
            
            // TODO: Parse the tweaked JSON, save to Game doc, award points

            return res.send({
                type: InteractionResponseType.UPDATE_MESSAGE,
                data: {
                    content: `✏️ ✅ **Tweaked & Approved by <@${interaction.member.user.id}>**`,
                    components: []
                }
            });
        }
    }
});

// --- CONTRIBUTION ROUTES ---

app.post('/api/contribute', async (req, res) => {
    const sessionToken = req.cookies.nurture_session;
    if (!sessionToken) return res.status(401).json({ error: "Must be signed in to contribute." });

    try {
        const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) return res.status(401).json({ error: "User not found." });

        const { gameId, itemCategory, actionType, targetIdentifier, data } = req.body;

        // 1. Save draft to MongoDB
        const newContribution = new Contribution({
            submitterDiscordId: user.discordId,
            submitterUsername: user.username,
            gameId,
            itemCategory,
            actionType,
            targetIdentifier,
            data
        });
        await newContribution.save();

        // 2. Fire serverless HTTP request to Discord to trigger the admin embed
        const discordPayload = {
            embeds: [{
                title: `New Contribution: ${actionType}${itemCategory}`,
                description: `**From:** ${user.username}\n**Game:** ${gameId || 'N/A'}\n**Target:** ${targetIdentifier || 'N/A'}\n\n\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 3900)}\n\`\`\``,
                color: 0x7A6BB5
            }],
            components: [{
                type: 1,
                components: [
                    { type: 2, style: 3, label: "Approve", custom_id: `approve_${newContribution._id}` },
                    { type: 2, style: 1, label: "Tweak & Approve", custom_id: `tweak_${newContribution._id}` },
                    { type: 2, style: 4, label: "Deny", custom_id: `deny_${newContribution._id}` }
                ]
            }]
        };

        await axios.post(`https://discord.com/api/v10/channels/1559219529593397279/messages`, discordPayload, {
            headers: {
                'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        res.json({ success: true, message: "Contribution submitted for review!" });
    } catch (err) {
        console.error("Contribution error:", err);
        res.status(500).json({ error: "Failed to process contribution." });
    }
});

// --- LEADERBOARD & MAILBOX API ROUTES ---
app.get('/api/leaderboard', async (req, res) => {
    try {
        const allUsers = await User.find({}).sort({ totalPoints: -1 }).select('username discordId avatar totalPoints').lean();
        const top10 = allUsers.slice(0, 10);
        
        let userRank = null;
        const token = req.cookies.nurture_session;
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const userIdx = allUsers.findIndex(u => u.discordId === decoded.discordId);
                if (userIdx !== -1) {
                    userRank = {
                        rank: userIdx + 1,
                        username: allUsers[userIdx].username,
                        avatar: allUsers[userIdx].avatar,
                        discordId: allUsers[userIdx].discordId,
                        totalPoints: allUsers[userIdx].totalPoints || 0
                    };
                }
            } catch(e) {}
        }
        res.json({ top10, userRank });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
});

app.get('/api/leaderboard/game/:gameId', async (req, res) => {
    try {
        const gameId = req.params.gameId;
        const allUsers = await User.find({}).lean();
        
        allUsers.sort((a, b) => {
            const aPts = (a.gamePoints && a.gamePoints[gameId]) || 0;
            const bPts = (b.gamePoints && b.gamePoints[gameId]) || 0;
            return bPts - aPts;
        });

        const top10 = allUsers.slice(0, 10).map(u => ({
            username: u.username,
            discordId: u.discordId,
            avatar: u.avatar,
            points: (u.gamePoints && u.gamePoints[gameId]) || 0
        }));

        let userRank = null;
        const token = req.cookies.nurture_session;
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const userIdx = allUsers.findIndex(u => u.discordId === decoded.discordId);
                if (userIdx !== -1) {
                    userRank = {
                        rank: userIdx + 1,
                        username: allUsers[userIdx].username,
                        avatar: allUsers[userIdx].avatar,
                        discordId: allUsers[userIdx].discordId,
                        points: (allUsers[userIdx].gamePoints && allUsers[userIdx].gamePoints[gameId]) || 0
                    };
                }
            } catch(e) {}
        }
        res.json({ top10, userRank });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch game leaderboard" });
    }
});

app.post('/api/user/star', async (req, res) => {
    const token = req.cookies.nurture_session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        const { gameId } = req.body;

        if (user.starredGames.includes(gameId)) {
            user.starredGames = user.starredGames.filter(id => id !== gameId); 
        } else {
            user.starredGames.push(gameId); 
        }
        await user.save();
        res.json({ success: true, starredGames: user.starredGames });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/mailbox', async (req, res) => {
    const token = req.cookies.nurture_session;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('mailbox discordId');
        const contributions = await Contribution.find({ submitterDiscordId: user.discordId }).lean();
        
        let allItems = user.mailbox.map(m => ({
            direction: m.direction,
            subject: m.subject,
            content: m.content,
            adminUsername: m.adminUsername,
            adminAvatar: m.adminAvatar,
            date: m.date || new Date()
        }));

        // Dynamically inject all outgoing contributions into the mailbox view
        contributions.forEach(c => {
            allItems.push({
                direction: 'OUTBOUND_CONTRIBUTION',
                subject: `Suggested ${c.itemCategory} for ${c.gameId}`,
                content: `Target: ${c.targetIdentifier || 'N/A'}\nData: ${JSON.stringify(c.data)}`,
                status: c.status || 'pending',
                date: c.createdAt || c._id.getTimestamp()
            });
        });

        res.json(allItems.sort((a, b) => new Date(b.date) - new Date(a.date)));
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch mailbox" });
    }
});

app.post('/api/mailbox/send', async (req, res) => {
    const sessionToken = req.cookies.nurture_session;
    if (!sessionToken) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        const { subject, content } = req.body;

        user.mailbox.push({
            direction: 'OUTBOUND',
            subject: subject || 'User Inquiry',
            content,
            date: new Date()
        });
        await user.save();

        const discordPayload = {
            embeds: [{
                title: `📩 Mail from User: ${user.username} (${user.discordId})`,
                description: `**Subject:** ${subject}\n\n${content}`,
                color: 0x5865F2
            }],
            components: [{
                type: 1,
                components: [
                    { type: 2, style: 1, label: "Reply to User", custom_id: `replymail_${user._id}` }
                ]
            }]
        };

        await axios.post(`https://discord.com/api/v10/channels/1559219529593397279/messages`, discordPayload, {
            headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' }
        });

        res.json({ success: true, mailbox: user.mailbox });
    } catch (err) {
        console.error("Mailbox send error:", err);
        res.status(500).json({ error: "Failed to send message" });
    }
});

// --- UPDATED DISCORD INTERACTIONS (APPROVE / DENY / REPLY LOGIC) ---
app.post('/api/interactions', verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY), async (req, res) => {
    const interaction = req.body;
    if (interaction.type === InteractionType.PING) return res.send({ type: InteractionResponseType.PONG });

    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
        const customId = interaction.data.custom_id;
        const [action, targetId] = customId.split('_');

        try {
            // HANDLE REPLY TO MAILBOX BUTTON
            if (action === 'replymail') {
                return res.send({
                    type: InteractionResponseType.MODAL,
                    data: {
                        custom_id: `modal_replymail_${targetId}`,
                        title: "Reply to User",
                        components: [{
                            type: 1,
                            components: [{
                                type: 4, custom_id: "reply_text", label: "Message:", style: 2, min_length: 1, max_length: 2000, required: true
                            }]
                        }]
                    }
                });
            }

            // HANDLE CONTRIBUTION BUTTONS
            const contribution = await Contribution.findById(targetId);
            if (!contribution) return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: "Contribution not found.", flags: 64 } });

            const user = await User.findOne({ discordId: contribution.submitterDiscordId });
            const adminAvatar = interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';

            if (action === 'approve' || action === 'tweak_approve') {
                contribution.status = 'approved';
                await contribution.save();

                if (contribution.gameId) {
                    const game = await Game.findOne({ id: contribution.gameId });
                    if (game) {
                        const catArray = game[contribution.itemCategory.toLowerCase() + 's'] || game[contribution.itemCategory.toLowerCase()];
                        if (contribution.actionType === 'CREATE') { catArray.push({ ...contribution.data, _id: new mongoose.Types.ObjectId() }); }
                        else if (contribution.actionType === 'EDIT') {
                            const idx = catArray.findIndex(item => item._id.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier);
                            if (idx !== -1) catArray[idx] = { ...catArray[idx], ...contribution.data };
                        }
                        else if (contribution.actionType === 'DELETE') {
                            const idx = catArray.findIndex(item => item._id.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier);
                            if (idx !== -1) catArray.splice(idx, 1);
                        }
                        await game.save();
                    }
                } else if (contribution.actionType === 'CREATE' && contribution.itemCategory === 'Game') { await Game.create(contribution.data); }

                if (user) {
                    user.totalPoints += 50;
                    if (contribution.gameId) {
                        const currentPoints = user.gamePoints.get(contribution.gameId) || 0;
                        user.gamePoints.set(contribution.gameId, currentPoints + 50);
                    }
                    user.mailbox.push({
                        direction: 'INBOUND',
                        subject: 'Contribution Approved! (+50 pts)',
                        content: `Your submission for ${contribution.itemCategory} was approved!`,
                        adminUsername: interaction.member.user.username,
                        adminAvatar: adminAvatar,
                        date: new Date()
                    });
                    await user.save();
                }

                return res.send({
                    type: InteractionResponseType.UPDATE_MESSAGE,
                    data: { content: `✅ **Approved by <@${interaction.member.user.id}>**`, components: [] }
                });
            }

            if (action === 'deny') {
                contribution.status = 'rejected';
                await contribution.save();

                if (user) {
                    user.mailbox.push({
                        direction: 'INBOUND',
                        subject: 'Contribution Denied',
                        content: `Your submission for ${contribution.itemCategory} was reviewed and rejected.`,
                        adminUsername: interaction.member.user.username,
                        adminAvatar: adminAvatar,
                        date: new Date()
                    });
                    await user.save();
                }

                return res.send({
                    type: InteractionResponseType.UPDATE_MESSAGE,
                    data: { content: `❌ **Denied by <@${interaction.member.user.id}>**`, components: [] }
                });
            }

            if (action === 'tweak') {
                return res.send({
                    type: InteractionResponseType.MODAL,
                    data: {
                        custom_id: `modal_tweak_${targetId}`,
                        title: "Tweak Contribution",
                        components: [{ type: 1, components: [{ type: 4, custom_id: "tweaked_data", label: "Edit JSON:", style: 2, value: JSON.stringify(contribution.data, null, 2), required: true }] }]
                    }
                });
            }
        } catch (err) { console.error("Interaction error:", err); }
    }

    // HANDLE MODAL SUBMISSIONS
    if (interaction.type === InteractionType.MODAL_SUBMIT) {
        const customId = interaction.data.custom_id;
        
        // Modal: Reply to Mailbox
        if (customId.startsWith('modal_replymail_')) {
            const userId = customId.split('_')[2];
            const replyText = interaction.data.components[0].components[0].value;
            
            const user = await User.findById(userId);
            if (user) {
                user.mailbox.push({
                    direction: 'INBOUND',
                    subject: 'Message from Admin',
                    content: replyText,
                    adminUsername: interaction.member.user.username,
                    adminAvatar: interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
                    date: new Date()
                });
                await user.save();
            }

            return res.send({
                type: InteractionResponseType.UPDATE_MESSAGE,
                data: {
                    content: `✅ **Replied by <@${interaction.member.user.id}>:**\n> ${replyText.split('\n').join('\n> ')}`,
                    components: []
                }
            });
        }
        
        // Modal: Tweak Contribution
        if (customId.startsWith('modal_tweak_')) {
            return res.send({
                type: InteractionResponseType.UPDATE_MESSAGE,
                data: { content: `✏️ ✅ **Tweaked & Approved by <@${interaction.member.user.id}>**`, components: [] }
            });
        }
    }
});

// --- AUTH ROUTES ---

app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    const scopes = 'identify guilds'; 
    const discordLoginUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}`;
    res.redirect(discordLoginUrl);
});

// --- EXTERNAL GAME LOOKUP (NO API KEY REQUIRED) ---
app.get('/api/suggest/lookup', async (req, res) => {
    const term = req.query.term;
    if (!term) return res.status(400).json({ error: "No search term provided" });

    try {
        // Query the public Apple App Store API
        const response = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=1`);
        
        if (!response.data.results || response.data.results.length === 0) {
            return res.json({ found: false });
        }

        const appData = response.data.results[0];
        
        // Filter out redundant Apple tags like "Games" or "Entertainment"
        const cleanGenres = appData.genres.filter(g => g !== 'Games' && g !== 'Entertainment');

        res.json({
            found: true,
            name: appData.trackName,
            developer: appData.artistName,
            icon_url: appData.artworkUrl512, // High-res icon
            tags: cleanGenres,
            overview_text: appData.description
        });
    } catch (err) {
        console.error("External lookup error:", err);
        res.status(500).json({ error: "Failed to lookup game data." });
    }
});


app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided');

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI
        }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const discordUser = userResponse.data;

        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        const isMember = guildsResponse.data.some(guild => guild.id === process.env.NURTURE_GUILD_ID);

        let user = await User.findOne({ discordId: discordUser.id });
        if (user) {
            user.username = discordUser.username;
            user.avatar = discordUser.avatar;
            user.isNurtureMember = isMember;
            await user.save();
        } else {
            user = await User.create({
                discordId: discordUser.id,
                username: discordUser.username,
                avatar: discordUser.avatar,
                isNurtureMember: isMember
            });
        }

        const sessionToken = jwt.sign(
            { userId: user._id, discordId: user.discordId, isNurtureMember: user.isNurtureMember }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' } 
        );

        res.cookie('nurture_session', sessionToken, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production', 
            maxAge: 7 * 24 * 60 * 60 * 1000 
        });

        res.redirect('/');
    } catch (error) {
        console.error('OAuth Error:', error.response ? error.response.data : error.message);
        res.status(500).send('Authentication failed');
    }
});

app.get('/api/auth/me', async (req, res) => {
    const token = req.cookies.nurture_session;
    if (!token) return res.status(401).json({ authenticated: false });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) return res.status(401).json({ authenticated: false });

        res.json({
            authenticated: true,
            user: {
                username: user.username,
                discordId: user.discordId,
                avatar: user.avatar,
                isNurtureMember: user.isNurtureMember
            }
        });
    } catch (err) {
        res.status(401).json({ authenticated: false });
    }
});

app.get('/auth/logout', (req, res) => {
    res.clearCookie('nurture_session', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
    });
    res.redirect('/');
});

app.use('*', (req, res) => res.status(404).json({ error: 'API Endpoint not found' }));

if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}

module.exports = app;