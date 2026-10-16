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
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// Serverless-optimized MongoDB connection (Middleware Pattern)
const connectDB = async () => {
    // If already connected (readyState 1) or connecting (readyState 2), skip
    if (mongoose.connection.readyState >= 1) return;
    
    // Connect and enforce a 5-second timeout so it never hangs infinitely
    await mongoose.connect(process.env.MONGODB_URI, { 
        serverSelectionTimeoutMS: 5000 
    });
    console.log("Connected to MongoDB Atlas");
};

app.use(async (req, res, next) => {
    try {
        // Force the server to wait for the DB before running ANY route
        await connectDB();
        next();
    } catch (err) {
        console.error("Database connection error:", err);
        res.status(500).json({ error: "Database connection failed" });
    }
});

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
    // Only use xss() to strip malicious tags. Do NOT use validator.escape() as it ruins image URLs.
    sanitizeString: (str) => xss(str || ''),
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

// --- APP STORE MAJOR UPDATE DETECTOR (EXCLUDES BUG FIXES) ---
const isMajorAppStoreUpdate = (appData) => {
    if (!appData || !appData.currentVersionReleaseDate) return false;
    const version = (appData.version || '').trim();
    const notes = (appData.releaseNotes || '').trim();

    // 1. Check if the patch notes are purely generic bug-fix/stability text
    const bugFixOnlyRegex = /^(?:[-•*]\s*)?(?:minor\s+|various\s+|general\s+)?(?:bug\s*fix(?:es)?|issue\s*fix(?:es)?|fixed\s+(?:an?\s+|some\s+)?(?:bug|issue|crash|error)s?|stability\s+improvements?|performance\s+improvements?|optimization|text\s+fixes)(?:\s+and\s+(?:stability|performance|minor)\s+improvements?)*[\s.!]*$/i;
    const hasContentKeywords = /\b(new|event|character|hero|cookie|chapter|story|season|banner|mode|collab|anniversary|feature|stage|boss|level|system|rework|balance|expansion|outfit|skin|costume|weapon|update\s+\d)\b/i.test(notes);

    // Parse semantic version parts (e.g. "2.4.0" -> [2, 4, 0])
    const verParts = version.split('.').map(p => parseInt(p.replace(/\D/g, ''), 10)).filter(n => !isNaN(n));
    const isZeroPatchVer = verParts.length >= 2 && (verParts.length === 2 || verParts[2] === 0);

    // Exclude if notes explicitly look like a minor bug fix and don't mention content
    if (notes.length > 0 && notes.length < 180 && bugFixOnlyRegex.test(notes) && !isZeroPatchVer) {
        return false;
    }

    // Include if version is a major/minor ".0" release OR patch notes describe new content
    if (isZeroPatchVer || hasContentKeywords || notes.length >= 180) {
        return true;
    }

    return false;
};

// Non-blocking background sync so existing games automatically stay updated with Apple App Store data
let isSyncingAppStore = false;
const syncAppStoreUpdatesBackground = async (games) => {
    if (isSyncingAppStore) return;
    isSyncingAppStore = true;

    try {
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        const now = Date.now();

        // Check up to 3 stale games per cycle so we never hit Apple rate limits
        const staleGames = games.filter(g => {
            if (!g.name) return false;
            const lastChecked = g.app_store_checked_at ? new Date(g.app_store_checked_at).getTime() : 0;
            return (now - lastChecked) > SIX_HOURS;
        }).slice(0, 3);

        for (const g of staleGames) {
            try {
                const res = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(g.name)}&entity=software&limit=1`);
                const updates = { app_store_checked_at: new Date().toISOString() };

                if (res.data.results && res.data.results.length > 0) {
                    const appData = res.data.results[0];
                    if (isMajorAppStoreUpdate(appData)) {
                        updates.last_major_update_date = appData.currentVersionReleaseDate;
                        updates.latest_version = appData.version;
                    }
                }
                await Game.collection.updateOne({ id: g.id }, { $set: updates });
            } catch (e) {}
        }
    } finally {
        isSyncingAppStore = false;
    }
};

// --- API ROUTES ---
app.get('/api/games', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const startIndex = (page - 1) * limit;

    try {
        // Use native MongoDB driver to completely bypass Mongoose Schema stripping
        const allGames = await Game.collection.find({}).toArray();
        
        // Trigger non-blocking background check for App Store major updates
        syncAppStoreUpdatesBackground(allGames);
        
        allGames.sort((a, b) => {
            const aData = hasGameData(a);
            const bData = hasGameData(b);
            if (aData && !bData) return -1;
            if (!aData && bData) return 1;
            
            const aName = a.name || '';
            const bName = b.name || '';
            return aName.localeCompare(bName);
        });

        const paginatedGames = allGames.slice(startIndex, startIndex + limit).map(cleanEmptyArrays);

        res.json({
            games: paginatedGames,
            pagination: { page, limit, total: allGames.length, pages: Math.ceil(allGames.length / limit) }
        });
    } catch (err) {
        console.error("Failed to fetch games:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get('/api/games/:id', async (req, res) => {
    try {
        // Use native driver here as well to expose hidden fields
        const game = await Game.collection.findOne({ id: req.params.id });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        res.json(game);
    } catch (err) {
        console.error("Failed to fetch game:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get('/api/games/search/:term', async (req, res) => {
    const searchTerm = req.params.term;
    if (!validateInput.isValidSearch(searchTerm)) return res.status(400).json({ error: 'Invalid search term' });
    const sanitizedTerm = validateInput.sanitizeString(searchTerm);
    
    try {
        const results = await Game.collection.find({
            $or: [
                { name: { $regex: sanitizedTerm, $options: 'i' } },
                { developer: { $regex: sanitizedTerm, $options: 'i' } }
            ]
        }).limit(10).toArray();
        res.json(results.map(cleanEmptyArrays));
    } catch (err) {
        console.error("Search error:", err);
        res.status(500).json({ error: "Database error" });
    }
});

app.get('/api/history/:gameId/:identifier', async (req, res) => {
    try {
        const history = await Contribution.find({ 
            gameId: req.params.gameId, 
            targetIdentifier: req.params.identifier,
            status: 'approved'
        }).sort({ createdAt: -1 }).lean();
        
        res.json(history);
    } catch (err) {
        console.error("History fetch error:", err);
        res.status(500).json({ error: "Failed to fetch history" });
    }
});

app.post('/api/games/:id/rate', async (req, res) => {
    const sessionToken = req.cookies.nurture_session;
    if (!sessionToken) return res.status(401).json({ error: "Must be signed in to rate." });

    try {
        const decoded = jwt.verify(sessionToken, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(401).json({ error: "User not found." });

        const gameId = req.params.id;
        const { f2p, afk, story, gameplay } = req.body;

        const game = await Game.findOne({ id: gameId }).lean();
        if (!game) return res.status(404).json({ error: "Game not found." });

        let userRatings = game.user_ratings || [];
        
        // 1. Find if the user already rated this game to enforce the 1-rating limit
        const existingIdx = userRatings.findIndex(r => r.discordId === user.discordId);
        const newScore = { discordId: user.discordId, f2p: Number(f2p), afk: Number(afk), story: Number(story), gameplay: Number(gameplay) };
        
        if (existingIdx !== -1) {
            userRatings[existingIdx] = newScore; // Overwrite their old rating
        } else {
            userRatings.push(newScore); // Log their first rating
        }

        // 2. Mathematically recalculate the averages from scratch
        const totals = { f2p: 0, afk: 0, story: 0, gameplay: 0 };
        const counts = { f2p: 0, afk: 0, story: 0, gameplay: 0 };

        userRatings.forEach(r => {
            ['f2p', 'afk', 'story', 'gameplay'].forEach(cat => {
                if (r[cat] > 0) {
                    totals[cat] += r[cat];
                    counts[cat]++;
                }
            });
        });

        const newRatings = { ...game.ratings }; // Preserve Age Rating
        const newCounts = { total_reviews: userRatings.length };
        let overallTotal = 0;
        let overallCount = 0;

        ['f2p', 'afk', 'story', 'gameplay'].forEach(cat => {
            if (counts[cat] > 0) {
                newRatings[cat] = (totals[cat] / counts[cat]).toFixed(1);
                newCounts[cat] = counts[cat];
                overallTotal += totals[cat] / counts[cat];
                overallCount++;
            } else {
                newRatings[cat] = null;
                newCounts[cat] = 0;
            }
        });

        if (overallCount > 0) {
            newRatings.overall = (overallTotal / overallCount).toFixed(1);
        }
        
        // 3. Forcefully bypass schema restrictions to permanently save the new fields
        await Game.updateOne(
            { id: gameId }, 
            { $set: { ratings: newRatings, rating_counts: newCounts, user_ratings: userRatings } }, 
            { strict: false }
        );

        res.json({ success: true, ratings: newRatings, rating_counts: newCounts, user_ratings: userRatings });
    } catch (err) {
        console.error("Rating error:", err);
        res.status(500).json({ error: "Failed to save rating." });
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
            if (action === 'replymail') {
                return res.send({
                    type: InteractionResponseType.MODAL,
                    data: {
                        custom_id: `modal_replymail_${targetId}`,
                        title: "Reply to User",
                        components: [{ type: 1, components: [{ type: 4, custom_id: "reply_text", label: "Message:", style: 2, min_length: 1, max_length: 2000, required: true }] }]
                    }
                });
            }

            const contribution = await Contribution.findById(targetId);
            if (!contribution) return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: "Contribution not found.", flags: 64 } });

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

            // NOTE: No early res.send() here. We await all database processes first.
            const user = await User.findOne({ discordId: contribution.submitterDiscordId });
            const adminAvatar = interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';

            if (action === 'approve') {
                await Contribution.updateOne({ _id: contribution._id }, { $set: { status: 'approved' } });

                if (contribution.itemCategory === 'Game' && contribution.actionType === 'CREATE') {
                    const existing = await Game.findOne({ id: contribution.gameId });
                    if (!existing) await Game.create(contribution.data);
                } else if (contribution.gameId) {
                    const game = await Game.findOne({ id: contribution.gameId });
                    if (game) {
                        if (contribution.itemCategory === 'Overview' || contribution.itemCategory === 'Game') {
                            let updates = {};
                            
                            if (contribution.data.overview_text !== undefined) updates.overview_text = contribution.data.overview_text;
                            if (contribution.data.new_player_guide !== undefined) updates.new_player_guide = contribution.data.new_player_guide;
                            
                            // Keep the starter guide and the trailer completely separate
                            if (contribution.data.new_player_video_id !== undefined) updates.new_player_video_id = contribution.data.new_player_video_id;
                            if (contribution.data.trailer_id !== undefined) updates.trailer_id = contribution.data.trailer_id; 
                            
                            if (contribution.data.age !== undefined) {
                                updates['ratings.age'] = contribution.data.age;
                            }
                            
                            await Game.collection.updateOne({ id: contribution.gameId }, { $set: updates });
                        } else {
                            const catKey = contribution.itemCategory.toLowerCase() + 's';
                            const catArray = game[catKey] || game[contribution.itemCategory.toLowerCase()];
                            if (catArray) {
                                if (contribution.actionType === 'CREATE') {
                                    catArray.push({ 
                                        ...contribution.data, 
                                        submitterUsername: contribution.submitterUsername,
                                        submitterDiscordId: contribution.submitterDiscordId,
                                        _id: new mongoose.Types.ObjectId() 
                                    });
                                }
                                else if (contribution.actionType === 'EDIT') {
                                    const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier);
                                    if (idx !== -1) catArray[idx] = { ...catArray[idx], ...contribution.data };
                                }
                                else if (contribution.actionType === 'DELETE') {
                                    const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier);
                                    if (idx !== -1) catArray.splice(idx, 1);
                                }
                                game.markModified(catKey);
                                await game.save(); // Only save if we manipulated the array via Mongoose
                            }
                        }
                        // Destructive outer game.save() removed from here
                    }
                }

                if (user) {
                    user.totalPoints = (user.totalPoints || 0) + 1; // Exactly +1 point assigned
                    if (contribution.gameId) {
                        if (!user.gamePoints) user.gamePoints = new Map();
                        
                        // Mongoose strict typing handler for Maps vs POJOs
                        if (typeof user.gamePoints.get === 'function') {
                            user.gamePoints.set(contribution.gameId, (user.gamePoints.get(contribution.gameId) || 0) + 1);
                        } else {
                            user.gamePoints[contribution.gameId] = (user.gamePoints[contribution.gameId] || 0) + 1;
                            user.markModified('gamePoints');
                        }
                    }
                    user.mailbox.push({ direction: 'INBOUND', subject: 'Contribution Approved! (+1 pt)', content: `Your submission for ${contribution.itemCategory} was approved!`, adminUsername: interaction.member.user.username, adminAvatar: adminAvatar, date: new Date() });
                    await user.save();
                }

                // EXACTLY ONE RESPONSE FIRED AT THE VERY END
                return res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `✅ **Approved by <@${interaction.member.user.id}>**`, components: [] } });
            }

            if (action === 'deny') {
                await Contribution.updateOne({ _id: contribution._id }, { $set: { status: 'rejected' } });
                if (user) {
                    user.mailbox.push({ direction: 'INBOUND', subject: 'Contribution Denied', content: `Your submission for ${contribution.itemCategory} was reviewed and rejected.`, adminUsername: interaction.member.user.username, adminAvatar: adminAvatar, date: new Date() });
                    await user.save();
                }
                return res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `❌ **Denied by <@${interaction.member.user.id}>**`, components: [] } });
            }
        } catch (err) { 
            console.error("Interaction error:", err);
            return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: `❌ **Error processing action.**`, flags: 64 } });
        }
    }

    if (interaction.type === InteractionType.MODAL_SUBMIT) {
        const customId = interaction.data.custom_id;
        
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
            return res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `✅ **Replied by <@${interaction.member.user.id}>:**\n>${replyText.split('\n').join('\n> ')}`, components: [] } });
        }
        
        if (customId.startsWith('modal_tweak_')) {
            const contributionId = customId.split('_')[2];
            const newJsonDataRaw = interaction.data.components[0].components[0].value;
            
            try {
                const parsedData = JSON.parse(newJsonDataRaw); 
                const contribution = await Contribution.findById(contributionId);
                await Contribution.updateOne({ _id: contribution._id }, { $set: { status: 'approved', data: parsedData } });
                contribution.data = parsedData;

                if (contribution.itemCategory === 'Game' && contribution.actionType === 'CREATE') {
                    const existing = await Game.findOne({ id: contribution.gameId });
                    if (!existing) await Game.create(contribution.data);
                } else if (contribution.gameId) {
                    const game = await Game.findOne({ id: contribution.gameId });
                    if (game) {
                        if (contribution.itemCategory === 'Overview' || contribution.itemCategory === 'Game') {
                            let updates = {};
                            
                            if (contribution.data.overview_text !== undefined) updates.overview_text = contribution.data.overview_text;
                            if (contribution.data.new_player_guide !== undefined) updates.new_player_guide = contribution.data.new_player_guide;
                            
                            if (contribution.data.new_player_video_id !== undefined) updates.new_player_video_id = contribution.data.new_player_video_id;
                            if (contribution.data.trailer_id !== undefined) updates.trailer_id = contribution.data.trailer_id; 
                            
                            if (contribution.data.age !== undefined) {
                                updates['ratings.age'] = contribution.data.age;
                            }
                            
                            await Game.collection.updateOne({ id: contribution.gameId }, { $set: updates });
                        } else {
                            const catKey = contribution.itemCategory.toLowerCase() + 's';
                            const catArray = game[catKey] || game[contribution.itemCategory.toLowerCase()];
                            if (catArray) {
                                if (contribution.actionType === 'CREATE') {
                                    catArray.push({ 
                                        ...contribution.data, 
                                        submitterUsername: contribution.submitterUsername,
                                        submitterDiscordId: contribution.submitterDiscordId,
                                        _id: new mongoose.Types.ObjectId() 
                                    });
                                }
                                else if (contribution.actionType === 'EDIT') {
                                    const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier);
                                    if (idx !== -1) catArray[idx] = { ...catArray[idx], ...contribution.data };
                                }
                                else if (contribution.actionType === 'DELETE') {
                                    const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier);
                                    if (idx !== -1) catArray.splice(idx, 1);
                                }
                                game.markModified(catKey);
                                await game.save();
                            }
                        }
                    }
                }

                const user = await User.findOne({ discordId: contribution.submitterDiscordId });
                if (user) {
                    user.totalPoints = (user.totalPoints || 0) + 1; // Exactly +1 point assigned
                    if (contribution.gameId) {
                        if (!user.gamePoints) user.gamePoints = new Map();
                        
                        // Mongoose strict typing handler
                        if (typeof user.gamePoints.get === 'function') {
                            user.gamePoints.set(contribution.gameId, (user.gamePoints.get(contribution.gameId) || 0) + 1);
                        } else {
                            user.gamePoints[contribution.gameId] = (user.gamePoints[contribution.gameId] || 0) + 1;
                            user.markModified('gamePoints');
                        }
                    }
                    user.mailbox.push({ direction: 'INBOUND', subject: 'Contribution Approved! (+1 pt)', content: `Your submission for ${contribution.itemCategory} was tweaked and approved by an admin!`, adminUsername: interaction.member.user.username, adminAvatar: interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png', date: new Date() });
                    await user.save();
                }

                return res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `✏️ ✅ **Tweaked & Approved by <@${interaction.member.user.id}>**`, components: [] } });
            } catch (error) {
                return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: `❌ **Failed to save tweak! Invalid JSON syntax.**\n\`${error.message}\``, flags: 64 } });
            }
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

        // Anti-Spam / DoS Mitigation: 30-second cooldown
        const now = Date.now();
        if (user.lastActionTimestamp && (now - user.lastActionTimestamp.getTime()) < 30000) {
            return res.status(429).json({ error: "You are doing that too fast. Please wait 30 seconds." });
        }
        user.lastActionTimestamp = new Date();
        await user.save();

       // Recursive sanitization to strip script tags and prevent NoSQL operators
        const sanitizeObj = (obj) => {
            if (typeof obj === 'string') return validateInput.sanitizeString(obj);
            if (Array.isArray(obj)) return obj.map(sanitizeObj);
            if (typeof obj === 'object' && obj !== null) {
                const newObj = {};
                for (let key in obj) {
                    if (key.startsWith('$')) continue; // Drop malicious MongoDB operators
                    newObj[key] = sanitizeObj(obj[key]);
                }
                return newObj;
            }
            return obj;
        };

        const gameId = validateInput.sanitizeString(req.body.gameId);
        const itemCategory = validateInput.sanitizeString(req.body.itemCategory);
        const actionType = validateInput.sanitizeString(req.body.actionType);
        const targetIdentifier = validateInput.sanitizeString(req.body.targetIdentifier);
        const data = sanitizeObj(req.body.data);

        // 1. Save sanitized draft to MongoDB
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
        const commitMessageText = data.commitMessage ? `\n**Commit Message:** ${data.commitMessage}` : '';
        const discordPayload = {
            embeds: [{
                title: `New Contribution: ${actionType}${itemCategory}`,
                description: `**From:** ${user.username}\n**Game:** ${gameId || 'N/A'}\n**Target:** ${targetIdentifier || 'N/A'}${commitMessageText}\n\n\`\`\`json\n${JSON.stringify(data, null, 2).substring(0, 3900)}\n\`\`\``,
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
        // Expose the raw error message to the frontend alert
        res.status(500).json({ error: err.message || "Failed to process contribution." });
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(decoded.userId) });
        if (!user) return res.status(401).json({ error: 'User not found' });

        const { gameId } = req.body;
        let starredGames = Array.isArray(user.starredGames) ? user.starredGames : [];

        if (starredGames.includes(gameId)) {
            starredGames = starredGames.filter(id => id !== gameId); 
        } else {
            starredGames.push(gameId); 
        }

        await User.collection.updateOne(
            { _id: user._id },
            { $set: { starredGames } }
        );
        res.json({ success: true, starredGames });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Unified Cross-Device Sync Endpoint (Settings, Subnav Favorites, Changelog State)
app.post('/api/user/sync', async (req, res) => {
    const token = req.cookies.nurture_session;
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const updates = {};

        // 1. Display Settings (showLb, lbSide)
        if (req.body.settings && typeof req.body.settings === 'object') {
            updates.settings = {
                showLb: Boolean(req.body.settings.showLb),
                lbSide: req.body.settings.lbSide === 'left' ? 'left' : 'right'
            };
        }

        // 2. Collapsed Changelog Version ID
        if (req.body.collapsedChangelogId !== undefined) {
            updates.collapsedChangelogId = validateInput.sanitizeString(String(req.body.collapsedChangelogId || ''));
        }

        // 3. Per-Game Favorited Subnav Items
        if (req.body.starredSubItems && typeof req.body.starredSubItems === 'object') {
            for (const [gId, items] of Object.entries(req.body.starredSubItems)) {
                const cleanGameId = validateInput.sanitizeString(gId).replace(/[.$]/g, '');
                if (cleanGameId && Array.isArray(items)) {
                    updates[`starredSubItems.${cleanGameId}`] = items
                        .slice(0, 200)
                        .map(id => validateInput.sanitizeString(String(id)));
                }
            }
        }

        //  4. Copied Coupon Codes [historical]
        if (req.body.copiedCoupons && typeof req.body.copiedCoupons === 'object') {
            for (const [gId, codes] of Object.entries(req.body.copiedCoupons)) {
                const cleanGameId = validateInput.sanitizeString(gId).replace(/[.$]/g, '');
                if (cleanGameId && Array.isArray(codes)) {
                    updates[`copiedCoupons.${cleanGameId}`] = codes
                        .slice(0, 200)
                        .map(c => validateInput.sanitizeString(String(c)));
                }
            }
        }

        if (Object.keys(updates).length > 0) {
            await User.collection.updateOne(
                { _id: new mongoose.Types.ObjectId(decoded.userId) },
                { $set: updates }
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error("User sync error:", err);
        res.status(500).json({ error: 'Failed to sync preferences' });
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
            id: m._id,
            direction: m.direction,
            subject: m.subject,
            content: m.content,
            adminUsername: m.adminUsername,
            adminAvatar: m.adminAvatar,
            date: m.date || new Date(),
            read: m.read || false
        }));

        // Dynamically inject all outgoing contributions into the mailbox view
        contributions.forEach(c => {
            let dataLines = [];
            
            // Format the JSON dump into a clean, readable bulleted list
            if (c.data && typeof c.data === 'object') {
                for (const [key, value] of Object.entries(c.data)) {
                    if (!value) continue;
                    let displayVal = Array.isArray(value) ? value.join(', ') : String(value);
                    
                    // Parse literal \n characters into actual line breaks for the UI
                    displayVal = displayVal.replace(/\\n/g, '\n').trim();
                    const cleanKey = key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' ');
                    dataLines.push(`▪ ${cleanKey}: ${displayVal}`);
                }
            }

            allItems.push({
                id: c._id,
                direction: 'OUTBOUND_CONTRIBUTION',
                subject: `Suggested ${c.itemCategory} for ${c.gameId || 'Unknown'}`,
                content: (c.targetIdentifier && c.targetIdentifier !== 'N/A' ? `Target: ${c.targetIdentifier}\n\n` : '') + dataLines.join('\n'),
                status: c.status || 'pending',
                date: c.createdAt || c._id.getTimestamp(),
                read: true
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
        let { subject, content } = req.body;
        
        // Strict Type & Length Enforcement
        if (!content || typeof content !== 'string') return res.status(400).json({ error: "Invalid message content." });
        
        content = content.substring(0, 2000); // Max Discord embed limit
        subject = (subject || 'User Inquiry').substring(0, 100);

        // 1. Push to user's local mailbox as OUTBOUND
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

app.post('/api/mailbox/mark-read', async (req, res) => {
    const token = req.cookies.nurture_session;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await User.findById(decoded.userId);
        const { messageIds } = req.body;
        
        if (messageIds && messageIds.length > 0) {
            user.mailbox.forEach(m => {
                if (messageIds.includes(m._id.toString())) m.read = true;
            });
        } else {
            // If array is empty, mark all as read
            user.mailbox.forEach(m => m.read = true);
        }
        
        user.markModified('mailbox');
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to update mailbox" });
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
            if (action === 'replymail') {
                return res.send({
                    type: InteractionResponseType.MODAL,
                    data: {
                        custom_id: `modal_replymail_${targetId}`,
                        title: "Reply to User",
                        components: [{ type: 1, components: [{ type: 4, custom_id: "reply_text", label: "Message:", style: 2, min_length: 1, max_length: 2000, required: true }] }]
                    }
                });
            }

            const contribution = await Contribution.findById(targetId);
            if (!contribution) return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: "Contribution not found.", flags: 64 } });

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

            // Immediately acknowledge Discord to prevent the 3-second timeout crash
            res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `⏳ **Processing... (<@${interaction.member.user.id}>)**`, components: [] } });

            const user = await User.findOne({ discordId: contribution.submitterDiscordId });
            const adminAvatar = interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png';

            // REMEMBER ME 1
            if (action === 'approve') {
                await Contribution.updateOne({ _id: contribution._id }, { $set: { status: 'approved' } });

                const nowIso = new Date().toISOString();

                if (contribution.itemCategory === 'Game' && contribution.actionType === 'CREATE') {
                    const existing = await Game.collection.findOne({ id: contribution.gameId });
                    if (!existing) {
                        await Game.collection.insertOne({
                            ...contribution.data,
                            createdAt: nowIso
                        });
                    }
                } else if (contribution.gameId) {
                    const game = await Game.findOne({ id: contribution.gameId });
                    if (game) {
                        if (contribution.itemCategory === 'Overview' || contribution.itemCategory === 'Game') {
                            let updates = { last_edited_at: nowIso };
                            
                            if (contribution.data.overview_text !== undefined) updates.overview_text = contribution.data.overview_text;
                            if (contribution.data.new_player_guide !== undefined) updates.new_player_guide = contribution.data.new_player_guide;
                            
                            // Save both "Where to Redeem" and "Where to Get Codes" links
                            if (contribution.data.redeem_portal_url !== undefined) updates.redeem_portal_url = contribution.data.redeem_portal_url;
                            if (contribution.data.redeem_codes_url !== undefined) updates.redeem_codes_url = contribution.data.redeem_codes_url;
                            
                            if (contribution.data.new_player_video_id !== undefined) updates.new_player_video_id = contribution.data.new_player_video_id;
                            if (contribution.data.trailer_id !== undefined) updates.trailer_id = contribution.data.trailer_id; 
                            
                            if (contribution.data.age !== undefined && contribution.data.age !== '') {
                                updates['ratings.age'] = contribution.data.age;
                            }
                            
                            await Game.collection.updateOne({ id: contribution.gameId }, { $set: updates });
                        } else {
                            // Supports Guide -> guides, Asset -> assets, Community -> communities, Mod -> mods, Coupon -> coupons
                            const lowerCat = contribution.itemCategory.toLowerCase();
                            const catKey = lowerCat === 'community' ? 'communities' : `${lowerCat}s`;
                            if (!Array.isArray(game[catKey])) game[catKey] = [];
                            const catArray = game[catKey];

                            if (contribution.actionType === 'CREATE') {
                                catArray.push({ 
                                    ...contribution.data, 
                                    submitterUsername: contribution.submitterUsername,
                                    submitterDiscordId: contribution.submitterDiscordId,
                                    createdAt: nowIso,
                                    _id: new mongoose.Types.ObjectId() 
                                });
                            }
                            else if (contribution.actionType === 'EDIT') {
                                const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier || item.code === contribution.targetIdentifier);
                                if (idx !== -1) {
                                    catArray[idx] = { 
                                        ...catArray[idx], 
                                        ...contribution.data,
                                        updatedAt: nowIso
                                    };
                                }
                            }
                            else if (contribution.actionType === 'DELETE') {
                                const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier || item.code === contribution.targetIdentifier);
                                if (idx !== -1) catArray.splice(idx, 1);
                            }

                            await Game.collection.updateOne(
                                { id: contribution.gameId },
                                { $set: { [catKey]: catArray, last_edited_at: nowIso } }
                            );
                        }
                    }
                }

                if (user) {
                    user.totalPoints = (user.totalPoints || 0) + 50;
                    if (contribution.gameId) {
                        if (!user.gamePoints) user.gamePoints = new Map();
                        const currentPts = user.gamePoints.get(contribution.gameId) || 0;
                        user.gamePoints.set(contribution.gameId, currentPts + 50);
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

                await axios.patch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${interaction.token}/messages/@original`, { content: `✅ **Approved by <@${interaction.member.user.id}>**` });
            }

            if (action === 'deny') {
                await Contribution.updateOne({ _id: contribution._id }, { $set: { status: 'rejected' } });
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
                await axios.patch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${interaction.token}/messages/@original`, { content: `❌ **Denied by <@${interaction.member.user.id}>**` });
            }
        } catch (err) { console.error("Interaction error:", err); }
    }

    if (interaction.type === InteractionType.MODAL_SUBMIT) {
        const customId = interaction.data.custom_id;
        
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
            return res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `✅ **Replied by <@${interaction.member.user.id}>:**\n>${replyText.split('\n').join('\n> ')}`, components: [] } });
        }
        
        // REMEMBER ME 2
        if (customId.startsWith('modal_tweak_')) {
            const contributionId = customId.split('_')[2];
            const newJsonDataRaw = interaction.data.components[0].components[0].value;
            
            try {
                const parsedData = JSON.parse(newJsonDataRaw); 
                res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `⏳ **Saving tweak... (<@${interaction.member.user.id}>)**`, components: [] } });
                
                const contribution = await Contribution.findById(contributionId);
                await Contribution.updateOne({ _id: contribution._id }, { $set: { status: 'approved', data: parsedData } });
                contribution.data = parsedData;
                const nowIso = new Date().toISOString();

                if (contribution.itemCategory === 'Game' && contribution.actionType === 'CREATE') {
                    const existing = await Game.collection.findOne({ id: contribution.gameId });
                    if (!existing) {
                        await Game.collection.insertOne({
                            ...contribution.data,
                            createdAt: nowIso
                        });
                    }
                } else if (contribution.gameId) {
                    const game = await Game.findOne({ id: contribution.gameId });
                    if (game) {
                        if (contribution.itemCategory === 'Overview' || contribution.itemCategory === 'Game') {
                            let updates = { last_edited_at: nowIso };
                            
                            if (contribution.data.overview_text !== undefined) updates.overview_text = contribution.data.overview_text;
                            if (contribution.data.new_player_guide !== undefined) updates.new_player_guide = contribution.data.new_player_guide;
                            
                            // Save both "Where to Redeem" and "Where to Get Codes" links
                            if (contribution.data.redeem_portal_url !== undefined) updates.redeem_portal_url = contribution.data.redeem_portal_url;
                            if (contribution.data.redeem_codes_url !== undefined) updates.redeem_codes_url = contribution.data.redeem_codes_url;
                            
                            if (contribution.data.new_player_video_id !== undefined) updates.new_player_video_id = contribution.data.new_player_video_id;
                            if (contribution.data.trailer_id !== undefined) updates.trailer_id = contribution.data.trailer_id; 
                            
                            if (contribution.data.age !== undefined && contribution.data.age !== '') {
                                updates['ratings.age'] = contribution.data.age;
                            }
                            
                            await Game.collection.updateOne({ id: contribution.gameId }, { $set: updates });
                        } else {
                            // Supports Guide -> guides, Asset -> assets, Community -> communities, Mod -> mods, Coupon -> coupons
                            const lowerCat = contribution.itemCategory.toLowerCase();
                            const catKey = lowerCat === 'community' ? 'communities' : `${lowerCat}s`;
                            if (!Array.isArray(game[catKey])) game[catKey] = [];
                            const catArray = game[catKey];

                            if (contribution.actionType === 'CREATE') {
                                catArray.push({ 
                                    ...contribution.data, 
                                    submitterUsername: contribution.submitterUsername,
                                    submitterDiscordId: contribution.submitterDiscordId,
                                    createdAt: nowIso,
                                    _id: new mongoose.Types.ObjectId() 
                                });
                            }
                            else if (contribution.actionType === 'EDIT') {
                                const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier || item.code === contribution.targetIdentifier);
                                if (idx !== -1) {
                                    catArray[idx] = { 
                                        ...catArray[idx], 
                                        ...contribution.data,
                                        updatedAt: nowIso
                                    };
                                }
                            }
                            else if (contribution.actionType === 'DELETE') {
                                const idx = catArray.findIndex(item => item._id?.toString() === contribution.targetIdentifier || item.title === contribution.targetIdentifier || item.code === contribution.targetIdentifier);
                                if (idx !== -1) catArray.splice(idx, 1);
                            }

                            await Game.collection.updateOne(
                                { id: contribution.gameId },
                                { $set: { [catKey]: catArray, last_edited_at: nowIso } }
                            );
                        }
                    }
                }

                const user = await User.findOne({ discordId: contribution.submitterDiscordId });
                if (user) {
                    user.totalPoints = (user.totalPoints || 0) + 50;
                    if (contribution.gameId) {
                        if (!user.gamePoints) user.gamePoints = new Map();
                        const currentPts = user.gamePoints.get(contribution.gameId) || 0;
                        user.gamePoints.set(contribution.gameId, currentPts + 50);
                    }
                    user.mailbox.push({ direction: 'INBOUND', subject: 'Contribution Approved! (+50 pts)', content: `Your submission for ${contribution.itemCategory} was tweaked and approved by an admin!`, adminUsername: interaction.member.user.username, adminAvatar: interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png', date: new Date() });
                    await user.save();
                }

                await axios.patch(`https://discord.com/api/v10/webhooks/${process.env.DISCORD_CLIENT_ID}/${interaction.token}/messages/@original`, { content: `✏️ ✅ **Tweaked & Approved by <@${interaction.member.user.id}>**` });
            } catch (error) {
                return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: `❌ **Failed to save tweak! Invalid JSON syntax.**\n\`${error.message}\``, flags: 64 } });
            }
        }
    }
});

// --- PUBLIC PROFILE ROUTES ---
app.get('/api/profile/:query', async (req, res) => {
    try {
        const query = validateInput.sanitizeString(req.params.query);
        
        // Lookup by discordId first, then exact username fallback
        let user = await User.findOne({ discordId: query }).lean();
        if (!user) user = await User.findOne({ username: new RegExp(`^${query}$`, 'i') }).lean();
        
        if (!user) return res.status(404).json({ error: "User not found" });

        // Fetch their approved contributions
        const contributions = await Contribution.find({ submitterDiscordId: user.discordId, status: 'approved' })
            .sort({ createdAt: -1 })
            .limit(25)
            .lean();

        res.json({
            username: user.username,
            avatar: user.avatar,
            discordId: user.discordId,
            totalPoints: user.totalPoints || 0,
            contributions: contributions.map(c => ({
                gameId: c.gameId,
                category: c.itemCategory,
                action: c.actionType,
                commitMessage: c.data?.commitMessage || '',
                target: c.targetIdentifier || (c.data && (c.data.title || c.data.name)) || 'Unknown Submission',
                date: c.createdAt || c._id.getTimestamp()
            }))
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to load profile" });
    }
});

// --- AUTH ROUTES ---
app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    const scopes = 'identify guilds'; 
    
    // Generate and store CSRF state token
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 10 }); // 10 mins

    const discordLoginUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}`;
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
        const cleanGenres = appData.genres.filter(g => g !== 'Games' && g !== 'Entertainment');
        const majorUpdate = isMajorAppStoreUpdate(appData);

        res.json({
            found: true,
            name: appData.trackName,
            developer: appData.artistName,
            icon_url: appData.artworkUrl512,
            tags: cleanGenres,
            overview_text: appData.description,
            latest_version: appData.version || null,
            last_major_update_date: majorUpdate ? appData.currentVersionReleaseDate : null
        });
    } catch (err) {
        console.error("External lookup error:", err);
        res.status(500).json({ error: "Failed to lookup game data." });
    }
});

// --- DYNAMIC OPEN GRAPH EMBED ROUTE FOR GAME PAGES ---
app.get('/games/:id', async (req, res) => {
    try {
        const gamePath = path.join(__dirname, 'game.html');
        let html = fs.readFileSync(gamePath, 'utf8');
        const game = await Game.collection.findOne({ id: req.params.id });

        if (game) {
            const escMeta = (str) => (str || '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
            const title = `Nurture | ${escMeta(game.name)} — Guides, Codes, Assets & Mods`;
            const rawDesc = game.overview_text 
                ? game.overview_text.replace(/\s+/g, ' ').trim().substring(0, 195) + '...'
                : `Explore community-curated guides, active redeem codes, raw assets, and mods for ${game.name} on Nurture.`;
            const desc = escMeta(rawDesc);
            const image = game.banner_url && game.banner_url.startsWith('http')
                ? escMeta(game.banner_url)
                : `https://${req.get('host')}${game.banner_url || '/Assets/nurture_icon.png'}`;
            const pageUrl = `https://${req.get('host')}${req.originalUrl}`;

            html = html
                .replace(/<title>.*?<\/title>/i, `<title>${title}</title>`)
                .replace(/content="__OG_TITLE__"/g, `content="${title}"`)
                .replace(/content="__OG_DESC__"/g, `content="${desc}"`)
                .replace(/content="__OG_IMAGE__"/g, `content="${image}"`)
                .replace(/content="__OG_URL__"/g, `content="${pageUrl}"`);
        }
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) {
        console.error("Error rendering game page embed:", err);
        res.sendFile(path.join(__dirname, 'game.html'));
    }
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    const returnedState = req.query.state;
    const storedState = req.cookies.oauth_state;

    if (!code) return res.status(400).send('No code provided');
    if (!returnedState || returnedState !== storedState) return res.status(403).send('OAuth CSRF verification failed.');
    
    res.clearCookie('oauth_state'); // Clear the single-use token

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
            { expiresIn: '365d' } // Extended to 1 Year
        );

        res.cookie('nurture_session', sessionToken, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production', 
            sameSite: 'lax', // Safely allows cookies on external link clicks
            maxAge: 365 * 24 * 60 * 60 * 1000 
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(decoded.userId) });
        
        if (!user) return res.status(401).json({ authenticated: false });

        res.json({
            authenticated: true,
            user: {
                username: user.username,
                discordId: user.discordId,
                avatar: user.avatar,
                isNurtureMember: user.isNurtureMember,
                starredGames: user.starredGames || [],
                starredSubItems: user.starredSubItems || {},
                settings: user.settings || null,
                collapsedChangelogId: user.collapsedChangelogId || '',
                copiedCoupons: user.copiedCoupons || {}
            }
        });
        
    } catch (err) {
        console.error("Auth validation error:", err);
        res.status(401).json({ authenticated: false });
    }
});

app.get('/auth/logout', (req, res) => {
    res.clearCookie('nurture_session', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    });
    res.redirect('/');
});

app.use('*', (req, res) => res.status(404).json({ error: 'API Endpoint not found' }));

if (process.env.NODE_ENV !== 'production') {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}

module.exports = app;