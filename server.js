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

// ============================================================================
// WEIGHTED CONTRIBUTION POINTS CONFIG
// Editing doesn't affect scores already in the databsae - only future contributions.
// ============================================================================
const POINT_WEIGHTS = {
    RATE_GAME: 1,              // Rating a game (awarded once per game per user)
    CREATE_GAME: 2,            // Suggesting a brand new game
    EDIT_GAME_INFO: 2,         // Updating trailer, age rating, tags, overview, or redeem URL
    CREATE_GUIDE: 2,           // Adding a new Guide or Tool
    EDIT_GUIDE: 2,             // Editing an existing Guide or Tool
    CREATE_MOD: 2,             // Adding a new Mod
    EDIT_MOD: 2,               // Editing an existing Mod
    CREATE_ASSET: 2,           // Adding Raw Assets
    EDIT_ASSET: 2,             // Editing Raw Assets
    CREATE_COMMUNITY: 2,       // Adding a Community link
    EDIT_COMMUNITY: 2,         // Editing a Community link
    CREATE_COUPON: 2,          // Adding a live Coupon Code
    REPORT_EXPIRED_COUPON: 2,  // Flagging an expired Coupon Code
    CREATE_SUBPAGETAG: 1,      // Suggesting a new Subpage Filter Tag
    CREATE_LORE: 2,            // Adding a Lore link/resource
    EDIT_LORE: 2,              // Editing a Lore link/resource
    CREATE_LORECHAPTER: 3,     // Suggesting a Story Master Chapter
    CREATE_LORENODE: 2,        // Adding a Story Master Chronological Node
    EDIT_LORENODE: 2,          // Editing a Story Master Node
    CREATE_LOREEDGE: 1,        // Connecting two Story Master Nodes (Edge)
    DEFAULT: 2                 // Fallback for any other approved action
};

// Remove strict Mongoose enum validation on Contribution.itemCategory so Coupon, SubpageTag & Lore categories never fail
if (Contribution.schema && Contribution.schema.path('itemCategory')) {
    Contribution.schema.path('itemCategory').enumValues = [];
    Contribution.schema.path('itemCategory').validators = [];
}

const getContributionPoints = (contribution) => {
    const action = (contribution.actionType || 'EDIT').toUpperCase();
    const cat = (contribution.itemCategory || '').toUpperCase();
    const hasCode = Boolean(contribution.data && contribution.data.code);

    if (cat === 'COUPON' || hasCode) {
        return action === 'DELETE' ? POINT_WEIGHTS.REPORT_EXPIRED_COUPON : POINT_WEIGHTS.CREATE_COUPON;
    }
    if (cat === 'GAME' || cat === 'OVERVIEW') {
        return action === 'CREATE' ? POINT_WEIGHTS.CREATE_GAME : POINT_WEIGHTS.EDIT_GAME_INFO;
    }
    const key = `${action}_${cat}`;
    return POINT_WEIGHTS[key] !== undefined ? POINT_WEIGHTS[key] : POINT_WEIGHTS.DEFAULT;
};

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
    return !!(game.overview_text || (game.guides && game.guides.length) || (game.assets && game.assets.length) || (game.communities && game.communities.length) || (game.lore && game.lore.length) || (game.mods && game.mods.length) || game.trailer_id || game.ratings);
};
// Helper to strip empty arrays so the frontend properly grays out inactive games
const cleanEmptyArrays = (game) => {
    if (game.guides && game.guides.length === 0) delete game.guides;
    if (game.assets && game.assets.length === 0) delete game.assets;
    if (game.communities && game.communities.length === 0) delete game.communities;
    if (game.lore && game.lore.length === 0) delete game.lore;
    if (game.mods && game.mods.length === 0) delete game.mods;
    if (game.mini_focuses && game.mini_focuses.length === 0) delete game.mini_focuses;
    return game;
};

// Extracts an 11-character YouTube Video ID from any YouTube URL or raw ID string
const extractYouTubeId = (input) => {
    if (!input || typeof input !== 'string') return '';
    const trimmed = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
    const match = trimmed.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*v=|embed\/|v\/|shorts\/))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : '';
};

// Converts raw contribution data into a clean, non-technical summary for Discord & User Mailboxes
const formatContributionHumanReadable = (category, action, target, data) => {
    if (!data || typeof data !== 'object') return 'No additional details.';
    const labelMap = {
        name: 'Game Name',
        title: 'Title',
        developer: 'Developer',
        code: 'Coupon Code',
        rewards: 'Rewards',
        url: 'Link',
        download_url: 'Download Link',
        wiki_url: 'Mod Wiki Link',
        redeem_portal_url: 'Redemption Page Link',
        redeem_codes_url: 'Codes List Link',
        author: 'Author / Info',
        category: 'Category',
        targetMod: 'For Mod / Modpack',
        overview_text: 'Overview Text',
        new_player_guide: 'New Player Guide Video',
        new_player_video_id: 'New Player Video ID',
        trailer_id: 'Trailer Video ID',
        age: 'Age Rating (ESRB)',
        tags: 'Tags',
        commitMessage: 'Contributor Note',
        // Story Map
        chapterTitle: 'Chapter Title',
        description: 'Description',
        coverIcon: 'Chapter Icon',
        eraLabel: 'Time Period / Era',
        timeOrder: 'Chronological Row (1 = Oldest)',
        parallelSlot: 'Horizontal Slot (Same-Time Position)',
        summary: 'Lore Summary',
        characters: 'Related Characters / Factions',
        fromTitle: 'From Event (Older)',
        toTitle: 'To Event (Newer / Concurrent)',
        relationLabel: 'Connection Label'
    };

    const ignoredKeys = new Set(['id', 'platform', 'type', 'version', 'latest_version', 'last_major_update_date', 'latest_update_images', 'banner_url']);
    const lines = [];

    for (const [key, rawVal] of Object.entries(data)) {
        if (ignoredKeys.has(key) || rawVal === undefined || rawVal === null || rawVal === '') continue;
        if (Array.isArray(rawVal) && rawVal.length === 0) continue;

        let valStr = Array.isArray(rawVal) ? rawVal.join(', ') : String(rawVal).replace(/\\n/g, '\n').trim();
        if (!valStr) continue;
        if (valStr.length > 350) valStr = valStr.substring(0, 350) + '...';

        const friendlyLabel = labelMap[key] || (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '));
        lines.push(`• **${friendlyLabel}:** ${valStr}`);
    }

    if (data.banner_url) {
        lines.push(`• **Game Icon:** [View Image](${data.banner_url})`);
    }

    return lines.length > 0 ? lines.join('\n') : `• **Target:** ${target || category}`;
};

// Ensures every game has at least the 'Mobile' platform tag if no platform tag is present
const ensureDefaultMobileTag = async (games) => {
    const bulkOps = [];
    games.forEach(g => {
        if (!Array.isArray(g.tags)) g.tags = [];
        const hasPlatform = g.tags.some(t => t === 'PC' || t === 'Mobile' || t === 'PC+Mobile');
        if (!hasPlatform) {
            g.tags.unshift('Mobile');
            if (g.id) {
                bulkOps.push({
                    updateOne: {
                        filter: { id: g.id },
                        update: { $set: { tags: g.tags } }
                    }
                });
            }
        }
    });
    if (bulkOps.length > 0) {
        try { await Game.collection.bulkWrite(bulkOps, { ordered: false }); } catch (e) {}
    }
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

// Smart App Store matcher that prevents spin-offs/sequels (e.g. "Origin") from overwriting base games
const normalizeGameTitle = (str) => (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const findBestAppStoreMatch = (results, targetGame, allGames = []) => {
    if (!Array.isArray(results) || results.length === 0) return null;

    // 1. If this game already has a locked Apple trackId, prefer it unless another game also claims it
    if (targetGame.app_store_track_id) {
        const byId = results.find(r => r.trackId === targetGame.app_store_track_id);
        if (byId) return byId;
    }

    const targetNorm = normalizeGameTitle(targetGame.name);
    const otherGamesNorm = allGames
        .filter(g => g.id !== targetGame.id && g.name)
        .map(g => ({
            id: g.id,
            norm: normalizeGameTitle(g.name),
            banner: g.banner_url
        }));

    let bestMatch = null;
    let bestScore = -999;

    for (const candidate of results) {
        const candNorm = normalizeGameTitle(candidate.trackName);
        if (!candNorm) continue;

        // Block this candidate if its title or icon belongs more closely to ANOTHER game in our database
        // (e.g. Prevents "The Seven Deadly Sins" from grabbing "The Seven Deadly Sins: Origin")
        const claimedByOther = otherGamesNorm.some(other => {
            if (other.norm === candNorm && other.norm !== targetNorm) return true;
            if (other.norm.length > targetNorm.length && candNorm.startsWith(other.norm)) return true;
            if (other.banner && other.banner === candidate.artworkUrl512 && other.norm !== targetNorm) return true;
            return false;
        });
        if (claimedByOther) continue;

        let score = 0;
        if (candNorm === targetNorm) {
            score += 100; // Exact title match
        } else if (candNorm.startsWith(targetNorm)) {
            const extraWords = candNorm.slice(targetNorm.length).trim().split(' ').filter(Boolean);
            // Penalize extra subtitle words so base titles prefer exact matches or known mobile subtitles (like "grand cross")
            score += 60 - (extraWords.length * 10);
            if (targetNorm === 'the seven deadly sins' && candNorm.includes('grand cross')) {
                score += 45;
            }
        } else if (targetNorm.startsWith(candNorm)) {
            score += 40;
        } else if (candNorm.includes(targetNorm)) {
            score += 20;
        } else {
            continue;
        }

        if (score > bestScore) {
            bestScore = score;
            bestMatch = candidate;
        }
    }

    return bestMatch;
};

// Non-blocking background sync for App Store major updates, icon changes, and duplicate-icon repair
let isSyncingAppStore = false;
const syncAppStoreUpdatesBackground = async (games) => {
    if (isSyncingAppStore) return;
    isSyncingAppStore = true;

    try {
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        const now = Date.now();

        // Detect any games accidentally sharing the exact same non-placeholder banner_url
        const bannerCounts = {};
        games.forEach(g => {
            if (g.banner_url && !g.banner_url.includes('placeholder')) {
                bannerCounts[g.banner_url] = (bannerCounts[g.banner_url] || 0) + 1;
            }
        });

        const staleGames = games.filter(g => {
            if (!g.name) return false;
            // Skip PC-only games since they do not use the Apple App Store API
            const gTags = Array.isArray(g.tags) ? g.tags : [];
            if (gTags.includes('PC') && !gTags.includes('Mobile') && !gTags.includes('PC+Mobile')) {
                return false;
            }
            const hasDuplicateIcon = g.banner_url && bannerCounts[g.banner_url] > 1;
            if (hasDuplicateIcon) return true;
            const lastChecked = g.app_store_checked_at ? new Date(g.app_store_checked_at).getTime() : 0;
            return (now - lastChecked) > SIX_HOURS;
        }).slice(0, 4);

        for (const g of staleGames) {
            try {
                // If searching base "The Seven Deadly Sins", include "Grand Cross" in query pool so Apple returns both
                const searchTerm = normalizeGameTitle(g.name) === 'the seven deadly sins'
                    ? 'The Seven Deadly Sins Grand Cross'
                    : g.name;

                const res = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=software&limit=15`);
                const updates = { app_store_checked_at: new Date().toISOString() };
                let changedVisibleData = false;

                if (res.data.results && res.data.results.length > 0) {
                    const appData = findBestAppStoreMatch(res.data.results, g, games);
                    if (appData) {
                        updates.app_store_track_id = appData.trackId;

                        const newIconUrl = (appData.artworkUrl512 || '').trim();
                        const isCustomLocalBanner = g.banner_url && g.banner_url.startsWith('/Assets/') && !g.banner_url.includes('placeholder');
                        if (newIconUrl && !isCustomLocalBanner && newIconUrl !== g.banner_url) {
                            updates.banner_url = newIconUrl;
                            g.banner_url = newIconUrl;
                            changedVisibleData = true;
                        }

                        if (isMajorAppStoreUpdate(appData)) {
                            if (g.last_major_update_date !== appData.currentVersionReleaseDate || g.latest_version !== appData.version) {
                                changedVisibleData = true;
                            }
                            updates.last_major_update_date = appData.currentVersionReleaseDate;
                            updates.latest_version = appData.version;
                            updates.latest_patch_notes = appData.releaseNotes || 'No specific patch notes provided.';
                            const shots = (Array.isArray(appData.screenshotUrls) && appData.screenshotUrls.length > 0)
                                ? appData.screenshotUrls.slice(0, 4)
                                : (Array.isArray(appData.ipadScreenshotUrls) ? appData.ipadScreenshotUrls.slice(0, 4) : []);
                            if (shots.length > 0) updates.latest_update_images = shots;
                        }
                    }
                }

                await Game.collection.updateOne({ id: g.id }, { $set: updates });
                if (changedVisibleData && typeof broadcastLiveEvent === 'function') {
                    broadcastLiveEvent('game_updated', { gameId: g.id });
                }
            } catch (e) {}
        }
    } finally {
        isSyncingAppStore = false;
    }
};

// --- IP & DISCORD BAN ENFORCEMENT HELPER ---
const getClientIp = (req) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
};

const checkUserOrIpBanned = async (user, clientIp) => {
    if (user && user.isBanned) {
        return true;
    }
    if (clientIp && clientIp !== 'unknown') {
        const bannedByIp = await User.collection.findOne({ isBanned: true, bannedIps: clientIp });
        if (bannedByIp) return true;
    }
    return false;
};

// --- REAL-TIME LIVE EVENT STREAM (DISCORD-STYLE PUSH UPDATES) ---
const liveClients = new Set();

const broadcastLiveEvent = (type, payload = {}) => {
    const msg = `data: ${JSON.stringify({ type, payload, timestamp: Date.now() })}\n\n`;
    for (const clientRes of liveClients) {
        try { clientRes.write(msg); } catch (e) { liveClients.delete(clientRes); }
    }
};

app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (res.flushHeaders) res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    liveClients.add(res);

    const keepAlive = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (e) { clearInterval(keepAlive); }
    }, 25000);

    req.on('close', () => {
        clearInterval(keepAlive);
        liveClients.delete(res);
    });
});

// --- API ROUTES ---
app.get('/api/games', async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const startIndex = (page - 1) * limit;

    try {
        const allGames = await Game.collection.find({}).toArray();
        
        // Automatically tag any untagged legacy games with 'Mobile' at minimum
        await ensureDefaultMobileTag(allGames);
        
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

// Helper to tally public favorite counts for all subnav items in a game
const getGameItemFavoriteCounts = async (gameId) => {
    const cleanGameId = validateInput.sanitizeString(gameId).replace(/[.$]/g, '');
    if (!cleanGameId) return {};

    const fieldPath = `starredSubItems.${cleanGameId}`;
    const usersWithFavs = await User.collection.find(
        { [fieldPath]: { $exists: true, $not: { $size: 0 } } },
        { projection: { [fieldPath]: 1 } }
    ).toArray();

    const counts = {};
    usersWithFavs.forEach(u => {
        const list = u.starredSubItems && u.starredSubItems[cleanGameId];
        if (Array.isArray(list)) {
            // Use Set per user so duplicate IDs in a single user document only count once
            [...new Set(list)].forEach(itemId => {
                counts[itemId] = (counts[itemId] || 0) + 1;
            });
        }
    });
    return counts;
};

app.get('/api/games/:id', async (req, res) => {
    try {
        const game = await Game.collection.findOne({ id: req.params.id });
        if (!game) return res.status(404).json({ error: 'Game not found' });

        await ensureDefaultMobileTag([game]);

        // Auto-convert any YouTube link in new_player_guide into new_player_video_id so it always embeds
        if (!game.new_player_video_id && game.new_player_guide) {
            const extractedVid = extractYouTubeId(game.new_player_guide);
            if (extractedVid) {
                game.new_player_video_id = extractedVid;
                await Game.collection.updateOne({ id: req.params.id }, { $set: { new_player_video_id: extractedVid } });
            }
        }

        // 1. Auto-recover any approved coupon contributions that were submitted under 'Game' or 'Coupon'
        const approvedCouponContribs = await Contribution.collection.find({
            gameId: req.params.id,
            status: 'approved',
            'data.code': { $exists: true,$ne: '' },
            actionType: 'CREATE'
        }).toArray();

        let coupons = Array.isArray(game.coupons) ? game.coupons : [];
        let modifiedCoupons = false;

        approvedCouponContribs.forEach(c => {
            const codeUpper = String(c.data.code).trim().toUpperCase();
            if (codeUpper && !coupons.some(existing => String(existing.code || '').toUpperCase() === codeUpper)) {
                coupons.push({
                    _id: c._id,
                    code: codeUpper,
                    rewards: c.data.rewards || c.data.url || 'In-game rewards',
                    submitterUsername: c.submitterUsername,
                    submitterDiscordId: c.submitterDiscordId,
                    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString()
                });
                modifiedCoupons = true;
            }
        });

        // 2. Auto-purge coupons that have been marked expired for over 30 days
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const now = Date.now();
        const filteredCoupons = coupons.filter(c => {
            if (!c.expiredAt) return true;
            const expMs = new Date(c.expiredAt).getTime();
            return !isNaN(expMs) && (now - expMs) <= THIRTY_DAYS_MS;
        });

        if (filteredCoupons.length !== coupons.length || modifiedCoupons) {
            coupons = filteredCoupons;
            await Game.collection.updateOne({ id: req.params.id }, { $set: { coupons } });
            game.coupons = coupons;
        }

        // 3. Attach public favorite counts for all subnav items in this game
        game.favoriteCounts = await getGameItemFavoriteCounts(req.params.id);

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

app.get('/api/history/game/:gameId', async (req, res) => {
    try {
        const history = await Contribution.collection.find({ 
            gameId: req.params.gameId,
            status: 'approved'
        }).sort({ createdAt: -1 }).limit(10).toArray();
        
        res.json(history);
    } catch (err) {
        console.error("Game History fetch error:", err);
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

        const clientIp = getClientIp(req);
        await User.collection.updateOne({ _id: user._id }, { $set: { lastIp: clientIp } });
        if (await checkUserOrIpBanned(user, clientIp)) {
            return res.status(403).json({ error: "Your account or IP address has been restricted from contributing." });
        }

        const gameId = req.params.id;
        const { f2p, afk, story, gameplay } = req.body;

        const game = await Game.findOne({ id: gameId }).lean();
        if (!game) return res.status(404).json({ error: "Game not found." });

        let userRatings = game.user_ratings || [];
        
        // 1. Find if the user already rated this game to enforce the 1-rating limit
        const existingIdx = userRatings.findIndex(r => r.discordId === user.discordId);
        const newScore = { discordId: user.discordId, f2p: Number(f2p), afk: Number(afk), story: Number(story), gameplay: Number(gameplay) };
        
        const isFirstTimeRating = existingIdx === -1;
        if (!isFirstTimeRating) {
            userRatings[existingIdx] = newScore; // Overwrite their old rating
        } else {
            userRatings.push(newScore); // Log their first rating
        }

        // Award +1 point on the user's first rating for this game
        if (isFirstTimeRating) {
            const ratePts = POINT_WEIGHTS.RATE_GAME;
            user.totalPoints = (user.totalPoints || 0) + ratePts;
            if (!user.gamePoints) user.gamePoints = new Map();
            if (typeof user.gamePoints.get === 'function') {
                user.gamePoints.set(gameId, (user.gamePoints.get(gameId) || 0) + ratePts);
            } else {
                user.gamePoints[gameId] = (user.gamePoints[gameId] || 0) + ratePts;
                user.markModified('gamePoints');
            }
            await user.save();
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

        broadcastLiveEvent('game_updated', { gameId });
        res.json({ success: true, ratings: newRatings, rating_counts: newCounts, user_ratings: userRatings });
    } catch (err) {
        console.error("Rating error:", err);
        res.status(500).json({ error: "Failed to save rating." });
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
        
        const clientIp = getClientIp(req);
        await User.collection.updateOne({ _id: user._id }, { $set: { lastIp: clientIp } });
        if (await checkUserOrIpBanned(user, clientIp)) {
            return res.status(403).json({ error: "Your account or IP address has been restricted from contributing." });
        }

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

        // Automatically extract YouTube video ID if a New Player Guide link was submitted
        if (data && data.new_player_guide) {
            const extractedId = extractYouTubeId(data.new_player_guide);
            if (extractedId) data.new_player_video_id = extractedId;
        }

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
        await newContribution.save({ validateBeforeSave: false });

        // 2. Send a clean, human-readable summary to Discord (no raw JSON dump)
        const readableSummary = formatContributionHumanReadable(itemCategory, actionType, targetIdentifier, data);
        const actionLabels = { CREATE: 'Add New', EDIT: 'Update', DELETE: 'Remove / Report Expired' };
        const friendlyAction = actionLabels[actionType] || actionType;

        const discordPayload = {
            embeds: [{
                title: `📬 ${friendlyAction} ${itemCategory} — ${gameId || 'General'}`,
                description: `**Submitted by:** ${user.username}\n**Target:** ${targetIdentifier || 'New Entry'}\n\n${readableSummary}`,
                color: 0x7A6BB5
            }],
            components: [{
                type: 1,
                components: [
                    { type: 2, style: 3, label: "Approve", custom_id: `approve_${newContribution._id}` },
                    { type: 2, style: 1, label: "Tweak & Approve", custom_id: `tweak_${newContribution._id}` },
                    { type: 2, style: 4, label: "Deny", custom_id: `deny_${newContribution._id}` },
                    { type: 2, style: 4, label: "Ban User + IP", custom_id: `banuser_${user.discordId}` }
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

// Expose live POINT_WEIGHTS so editing them at the top of server.js updates the UI automatically
app.get('/api/point-weights', (req, res) => {
    res.json(POINT_WEIGHTS);
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

        // 1. Display Settings (showLb, lbSide, lowSpecMode)
        if (req.body.settings && typeof req.body.settings === 'object') {
            updates.settings = {
                showLb: Boolean(req.body.settings.showLb),
                lbSide: req.body.settings.lbSide === 'left' ? 'left' : 'right',
                lowSpecMode: Boolean(req.body.settings.lowSpecMode)
            };
        }

        // 2. Collapsed Changelog Version ID
        if (req.body.collapsedChangelogId !== undefined) {
            updates.collapsedChangelogId = validateInput.sanitizeString(String(req.body.collapsedChangelogId || ''));
        }

       // 3. Per-Game Favorited Subnav Items
        const updatedFavGameIds = [];
        if (req.body.starredSubItems && typeof req.body.starredSubItems === 'object') {
            for (const [gId, items] of Object.entries(req.body.starredSubItems)) {
                const cleanGameId = validateInput.sanitizeString(gId).replace(/[.$]/g, '');
                if (cleanGameId && Array.isArray(items)) {
                    updates[`starredSubItems.${cleanGameId}`] = [...new Set(
                        items.slice(0, 200).map(id => validateInput.sanitizeString(String(id)))
                    )];
                    updatedFavGameIds.push(cleanGameId);
                }
            }
        }

        // 4. Copied Coupon Codes [historical]
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

        // 5. User Profile Canvas / Notebook Nodes
        if (Array.isArray(req.body.canvasNodes)) {
            updates.canvasNodes = req.body.canvasNodes.slice(0, 40).map(node => ({
                id: validateInput.sanitizeString(String(node.id || Date.now())),
                title: validateInput.sanitizeString(String(node.title || 'Untitled Node')).substring(0, 80),
                type: node.type === 'iframe' ? 'iframe' : 'image',
                url: validateInput.sanitizeString(String(node.url || '')).substring(0, 1200),
                width: Math.min(1400, Math.max(220, parseInt(node.width) || 360)),
                height: Math.min(1000, Math.max(180, parseInt(node.height) || 280))
            })).filter(n => n.url);
        }

        if (Object.keys(updates).length > 0) {
            await User.collection.updateOne(
                { _id: new mongoose.Types.ObjectId(decoded.userId) },
                { $set: updates }
            );
            updatedFavGameIds.forEach(gId => {
                broadcastLiveEvent('game_updated', { gameId: gId });
            });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("User sync error:", err);
        res.status(500).json({ error: 'Failed to sync preferences' });
    }
});

// --- DEVICE IMAGE UPLOAD ENDPOINT (CATBOX.MOE PRIMARY + FREEIMAGE.HOST FALLBACK) ---
app.post('/api/upload-image', async (req, res) => {
    const token = req.cookies.nurture_session;
    if (!token) return res.status(401).json({ error: 'Must be signed in to upload images.' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await User.collection.findOne({ _id: new mongoose.Types.ObjectId(decoded.userId) });
        if (!user) return res.status(401).json({ error: 'User not found.' });

        const clientIp = getClientIp(req);
        if (await checkUserOrIpBanned(user, clientIp)) {
            return res.status(403).json({ error: 'Your account has been restricted from uploading.' });
        }

        const { imageBase64, filename } = req.body;
        if (!imageBase64 || typeof imageBase64 !== 'string') {
            return res.status(400).json({ error: 'No image data provided.' });
        }

        const matches = imageBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ error: 'Invalid image format.' });
        }

        const mimeType = matches[1];
        const base64Data = matches[2];
        const fileBuffer = Buffer.from(base64Data, 'base64');

        if (fileBuffer.length > 8 * 1024 * 1024) {
            return res.status(400).json({ error: 'Image must be under 8MB.' });
        }

        const ext = (mimeType.split('/')[1] || 'webp').replace(/[^a-z0-9]/gi, '');
        const safeFilename = (filename || `nurture_${Date.now()}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');

        // 1. Primary Host: Catbox.moe (Permanent, fast, no API key required)
        try {
            const boundary = '----NurtureUploadBoundary' + crypto.randomBytes(8).toString('hex');
            const pre = Buffer.from(
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n` +
                `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="fileToUpload"; filename="${safeFilename}"\r\n` +
                `Content-Type: ${mimeType}\r\n\r\n`,
                'utf8'
            );
            const post = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
            const multipartBody = Buffer.concat([pre, fileBuffer, post]);

            const catboxRes = await axios.post('https://catbox.moe/user/api.php', multipartBody, {
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': multipartBody.length,
                    'User-Agent': 'NurtureHub/1.0'
                },
                timeout: 12000
            });

            if (typeof catboxRes.data === 'string' && catboxRes.data.trim().startsWith('https://')) {
                return res.json({ success: true, url: catboxRes.data.trim(), host: 'catbox' });
            }
        } catch (catboxErr) {
            console.warn('Catbox upload fallback triggered:', catboxErr.message);
        }

        // 2. Automatic Fallback Host: Freeimage.host API
        const formParams = new URLSearchParams();
        formParams.append('key', process.env.FREEIMAGE_API_KEY || '6d207e02198a847aa98d0a2a901485a5');
        formParams.append('action', 'upload');
        formParams.append('source', base64Data);
        formParams.append('format', 'json');

        const freeImgRes = await axios.post('https://freeimage.host/api/1/upload', formParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 12000
        });

        const hostedUrl = freeImgRes.data?.image?.url || freeImgRes.data?.image?.display_url;
        if (hostedUrl) {
            return res.json({ success: true, url: hostedUrl, host: 'freeimage' });
        }

        throw new Error('Image host did not return a valid URL.');
    } catch (err) {
        console.error('Image upload error:', err.message);
        res.status(500).json({ error: 'Failed to upload image. Please try again or paste a direct image link.' });
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

        // Dynamically inject all outgoing contributions into the mailbox view in human-readable format
        const actionLabels = { CREATE: 'Added', EDIT: 'Edited', DELETE: 'Reported Expired' };
        contributions.forEach(c => {
            const cleanSummary = formatContributionHumanReadable(c.itemCategory, c.actionType, c.targetIdentifier, c.data)
                .replace(/\*\*/g, ''); // Strip markdown asterisks for plain-text mailbox rendering

            allItems.push({
                id: c._id,
                direction: 'OUTBOUND_CONTRIBUTION',
                subject: `${actionLabels[c.actionType] || 'Suggested'} ${c.itemCategory} for ${c.gameId || 'Nurture'}`,
                content: cleanSummary,
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

        const clientIp = getClientIp(req);
        await User.collection.updateOne({ _id: user._id }, { $set: { lastIp: clientIp } });
        if (await checkUserOrIpBanned(user, clientIp)) {
            return res.status(403).json({ error: "Your account or IP address has been restricted from messaging." });
        }

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

// Applies approved LoreChapter, LoreNode, and LoreEdge contributions to game.story_master
const applyStoryMasterContribution = async (game, contribution, nowIso) => {
    const sm = (game.story_master && typeof game.story_master === 'object')
        ? {
            chapters: Array.isArray(game.story_master.chapters) ? [...game.story_master.chapters] : [],
            nodes: Array.isArray(game.story_master.nodes) ? [...game.story_master.nodes] : [],
            edges: Array.isArray(game.story_master.edges) ? [...game.story_master.edges] : []
        }
        : { chapters: [], nodes: [], edges: [] };

    const cat = contribution.itemCategory;
    const action = (contribution.actionType || 'CREATE').toUpperCase();
    const d = contribution.data || {};

    if (cat === 'LoreChapter') {
        if (action === 'CREATE') {
            const chapId = (d.id || d.title || `chapter_${Date.now()}`).toLowerCase().replace(/[^a-z0-9]+/g, '-');
            if (!sm.chapters.some(c => c.id === chapId)) {
                sm.chapters.push({
                    id: chapId,
                    title: d.title || 'Untitled Chapter',
                    description: d.description || 'Community-curated lore chapter.',
                    coverIcon: d.coverIcon || '📜',
                    submitterUsername: contribution.submitterUsername,
                    submitterDiscordId: contribution.submitterDiscordId,
                    createdAt: nowIso
                });
            }
        }
    } else if (cat === 'LoreNode') {
        if (action === 'CREATE') {
            sm.nodes.push({
                id: `node_${new mongoose.Types.ObjectId().toString()}`,
                chapterId: d.chapterId || 'main-storyline',
                title: d.title || 'Untitled Event',
                eraLabel: d.eraLabel || 'Unknown Era',
                timeOrder: Number(d.timeOrder) || 10,
                parallelSlot: Number(d.parallelSlot) || 0,
                summary: d.summary || '',
                characters: d.characters || '',
                sourceUrl: d.url || d.sourceUrl || '',
                iconUrl: d.iconUrl || '',
                submitterUsername: contribution.submitterUsername,
                submitterDiscordId: contribution.submitterDiscordId,
                createdAt: nowIso
            });
        } else if (action === 'EDIT') {
            const idx = sm.nodes.findIndex(n => n.id === contribution.targetIdentifier || n.title === contribution.targetIdentifier);
            if (idx !== -1) {
                sm.nodes[idx] = {
                    ...sm.nodes[idx],
                    title: d.title !== undefined ? d.title : sm.nodes[idx].title,
                    eraLabel: d.eraLabel !== undefined ? d.eraLabel : sm.nodes[idx].eraLabel,
                    timeOrder: d.timeOrder !== undefined ? Number(d.timeOrder) : sm.nodes[idx].timeOrder,
                    parallelSlot: d.parallelSlot !== undefined ? Number(d.parallelSlot) : sm.nodes[idx].parallelSlot,
                    summary: d.summary !== undefined ? d.summary : sm.nodes[idx].summary,
                    characters: d.characters !== undefined ? d.characters : sm.nodes[idx].characters,
                    sourceUrl: d.url !== undefined ? d.url : sm.nodes[idx].sourceUrl,
                    updatedAt: nowIso
                };
            }
        } else if (action === 'DELETE') {
            sm.nodes = sm.nodes.filter(n => n.id !== contribution.targetIdentifier && n.title !== contribution.targetIdentifier);
            sm.edges = sm.edges.filter(e => e.fromNodeId !== contribution.targetIdentifier && e.toNodeId !== contribution.targetIdentifier);
        }
    } else if (cat === 'LoreEdge') {
        if (action === 'CREATE' && d.fromNodeId && d.toNodeId && d.fromNodeId !== d.toNodeId) {
            const duplicate = sm.edges.some(e => e.fromNodeId === d.fromNodeId && e.toNodeId === d.toNodeId && e.chapterId === d.chapterId);
            if (!duplicate) {
                sm.edges.push({
                    id: `edge_${new mongoose.Types.ObjectId().toString()}`,
                    chapterId: d.chapterId || 'main-storyline',
                    fromNodeId: d.fromNodeId,
                    toNodeId: d.toNodeId,
                    relationLabel: d.relationLabel || 'Led to',
                    submitterUsername: contribution.submitterUsername,
                    submitterDiscordId: contribution.submitterDiscordId,
                    createdAt: nowIso
                });
            }
        } else if (action === 'DELETE') {
            sm.edges = sm.edges.filter(e => e.id !== contribution.targetIdentifier);
        }
    }

    await Game.collection.updateOne(
        { id: contribution.gameId },
        { $set: { story_master: sm, last_edited_at: nowIso } }
    );
};

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
            const adminAvatar = interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.webp` : 'https://cdn.discordapp.com/embed/avatars/0.webp';

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
                    const game = await Game.collection.findOne({ id: contribution.gameId });
                    if (game) {
                        // If a coupon code was submitted, always route it to game.coupons
                        const isCouponSubmission = contribution.itemCategory === 'Coupon' || Boolean(contribution.data && contribution.data.code);

                        if (!isCouponSubmission && (contribution.itemCategory === 'Overview' || contribution.itemCategory === 'Game')) {
                            let updates = { last_edited_at: nowIso };
                            
                            if (contribution.data.overview_text !== undefined) updates.overview_text = contribution.data.overview_text;
                            if (contribution.data.new_player_guide !== undefined) {
                                updates.new_player_guide = contribution.data.new_player_guide;
                                const extractedVid = extractYouTubeId(contribution.data.new_player_guide);
                                if (extractedVid) updates.new_player_video_id = extractedVid;
                            }
                            if (contribution.data.redeem_portal_url !== undefined) updates.redeem_portal_url = contribution.data.redeem_portal_url;
                            if (contribution.data.twitter_url !== undefined) updates.twitter_url = contribution.data.twitter_url;
                            if (contribution.data.redeem_codes_url !== undefined) updates.redeem_codes_url = contribution.data.redeem_codes_url;
                            if (contribution.data.new_player_video_id !== undefined) updates.new_player_video_id = contribution.data.new_player_video_id;
                            if (contribution.data.trailer_id !== undefined) updates.trailer_id = contribution.data.trailer_id; 
                            
                            if (contribution.data.age !== undefined && contribution.data.age !== '') {
                                updates['ratings.age'] = contribution.data.age;
                            }

                            if (Array.isArray(contribution.data.tags) && contribution.data.tags.length > 0) {
                                updates.tags = contribution.data.tags;
                            } else if (contribution.data.platform_tag && ['PC', 'Mobile', 'PC+Mobile'].includes(contribution.data.platform_tag)) {
                                const existingTags = Array.isArray(game.tags) ? game.tags.filter(t => !['PC', 'Mobile', 'PC+Mobile'].includes(t)) : [];
                                updates.tags = [contribution.data.platform_tag, ...existingTags];
                            }
                            
                            await Game.collection.updateOne({ id: contribution.gameId }, { $set: updates });
                        } else if (contribution.itemCategory === 'SubpageTag') {
                            const secKey = (contribution.data.section || 'guides').toLowerCase();
                            const newTag = (contribution.data.tag || '').trim();
                            if (newTag) {
                                const customSubtags = (game.custom_subtags && typeof game.custom_subtags === 'object') ? { ...game.custom_subtags } : {};
                                const existingList = Array.isArray(customSubtags[secKey]) ? customSubtags[secKey] : [];
                                if (!existingList.some(t => t.toLowerCase() === newTag.toLowerCase())) {
                                    existingList.push(newTag);
                                }
                                customSubtags[secKey] = existingList;
                                await Game.collection.updateOne(
                                    { id: contribution.gameId },
                                    { $set: { custom_subtags: customSubtags, last_edited_at: nowIso } }
                                );
                            }
                        } else if (['LoreChapter', 'LoreNode', 'LoreEdge'].includes(contribution.itemCategory)) {
                            await applyStoryMasterContribution(game, contribution, nowIso);
                        } else {
                            const lowerCat = isCouponSubmission ? 'coupon' : contribution.itemCategory.toLowerCase();
                            const catKey = lowerCat === 'community' ? 'communities' : (lowerCat === 'lore' ? 'lore' : `${lowerCat}s`);
                            const catArray = Array.isArray(game[catKey]) ? [...game[catKey]] : [];

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
                                if (idx !== -1) {
                                    if (catKey === 'coupons') {
                                        // Wrap expired coupon in red for 30 days instead of deleting immediately
                                        catArray[idx] = { ...catArray[idx], expiredAt: nowIso };
                                    } else {
                                        catArray.splice(idx, 1);
                                    }
                                }
                            }

                            await Game.collection.updateOne(
                                { id: contribution.gameId },
                                { $set: { [catKey]: catArray, last_edited_at: nowIso } }
                            );
                        }
                    }
                }

                if (user) {
                    const ptsEarned = getContributionPoints(contribution);
                    user.totalPoints = (user.totalPoints || 0) + ptsEarned;
                    if (contribution.gameId) {
                        if (!user.gamePoints) user.gamePoints = new Map();
                        if (typeof user.gamePoints.get === 'function') {
                            user.gamePoints.set(contribution.gameId, (user.gamePoints.get(contribution.gameId) || 0) + ptsEarned);
                        } else {
                            user.gamePoints[contribution.gameId] = (user.gamePoints[contribution.gameId] || 0) + ptsEarned;
                            user.markModified('gamePoints');
                        }
                    }
                    user.mailbox.push({
                        direction: 'INBOUND',
                        subject: `Contribution Approved! (+${ptsEarned} pt${ptsEarned !== 1 ? 's' : ''})`,
                        content: `Your submission for ${contribution.itemCategory} was approved!`,
                        adminUsername: interaction.member.user.username,
                        adminAvatar: adminAvatar,
                        date: new Date()
                    });
                    await user.save();
                }
                // Send notification live to user
                broadcastLiveEvent('game_updated', { gameId: contribution.gameId, discordId: contribution.submitterDiscordId });
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

            if (action === 'banuser') {
                const targetUser = await User.collection.findOne({ discordId: targetId });
                if (!targetUser) {
                    return res.send({ type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: "User not found.", flags: 64 } });
                }
                const bannedIps = Array.isArray(targetUser.bannedIps) ? targetUser.bannedIps : [];
                if (targetUser.lastIp && !bannedIps.includes(targetUser.lastIp)) {
                    bannedIps.push(targetUser.lastIp);
                }
                await User.collection.updateOne(
                    { discordId: targetId },
                    { $set: { isBanned: true, bannedIps, bannedAt: new Date().toISOString() } }
                );
                return res.send({
                    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
                    data: { content: `🔨 **Banned user \`${targetUser.username}\` (${targetId}) and IP \`${targetUser.lastIp || 'N/A'}\` from contributing.**` }
                });
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
                    adminAvatar: interaction.member.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.member.user.id}/${interaction.member.user.avatar}.webp` : 'https://cdn.discordapp.com/embed/avatars/0.webp',
                    date: new Date()
                });
                broadcastLiveEvent('mail_updated', { discordId: user.discordId });
                await user.save();
            }
            return res.send({ type: InteractionResponseType.UPDATE_MESSAGE, data: { content: `✅ **Replied by <@${interaction.member.user.id}>:**\n> ${replyText.split('\n').join('\n> ')}`, components: [] } });
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
                            if (contribution.data.new_player_guide !== undefined) {
                                updates.new_player_guide = contribution.data.new_player_guide;
                                const extractedVid = extractYouTubeId(contribution.data.new_player_guide);
                                if (extractedVid) updates.new_player_video_id = extractedVid;
                            }
                            
                            // Save both "Where to Redeem" and "Where to Get Codes" links
                            if (contribution.data.redeem_portal_url !== undefined) updates.redeem_portal_url = contribution.data.redeem_portal_url;
                            if (contribution.data.redeem_codes_url !== undefined) updates.redeem_codes_url = contribution.data.redeem_codes_url;
                            
                            if (contribution.data.new_player_video_id !== undefined) updates.new_player_video_id = contribution.data.new_player_video_id;
                            if (contribution.data.trailer_id !== undefined) updates.trailer_id = contribution.data.trailer_id; 
                            
                            if (contribution.data.age !== undefined && contribution.data.age !== '') {
                                updates['ratings.age'] = contribution.data.age;
                            }

                            if (Array.isArray(contribution.data.tags) && contribution.data.tags.length > 0) {
                                updates.tags = contribution.data.tags;
                            } else if (contribution.data.platform_tag && ['PC', 'Mobile', 'PC+Mobile'].includes(contribution.data.platform_tag)) {
                                const existingTags = Array.isArray(game.tags) ? game.tags.filter(t => !['PC', 'Mobile', 'PC+Mobile'].includes(t)) : [];
                                updates.tags = [contribution.data.platform_tag, ...existingTags];
                            }
                            
                            await Game.collection.updateOne({ id: contribution.gameId }, { $set: updates });
                        } else if (['LoreChapter', 'LoreNode', 'LoreEdge'].includes(contribution.itemCategory)) {
                            await applyStoryMasterContribution(game, contribution, nowIso);
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
                    const ptsEarned = getContributionPoints(contribution);
                    user.totalPoints = (user.totalPoints || 0) + ptsEarned;
                    if (contribution.gameId) {
                        if (!user.gamePoints) user.gamePoints = new Map();
                        if (typeof user.gamePoints.get === 'function') {
                            user.gamePoints.set(contribution.gameId, (user.gamePoints.get(contribution.gameId) || 0) + ptsEarned);
                        } else {
                            user.gamePoints[contribution.gameId] = (user.gamePoints[contribution.gameId] || 0) + ptsEarned;
                            user.markModified('gamePoints');
                        }
                    }
                    user.mailbox.push({
                        direction: 'INBOUND',
                        subject: `Contribution Approved! (+${ptsEarned} pt${ptsEarned !== 1 ? 's' : ''})`,
                        content: `Your submission for ${contribution.itemCategory} was approved!`,
                        adminUsername: interaction.member.user.username,
                        adminAvatar: adminAvatar,
                        date: new Date()
                    });
                    await user.save();
                }

                broadcastLiveEvent('game_updated', { gameId: contribution.gameId, discordId: contribution.submitterDiscordId });

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
        let user = await User.collection.findOne({ discordId: query });
        if (!user) user = await User.collection.findOne({ username: new RegExp(`^${query}$`, 'i') });
        if (!user) return res.status(404).json({ error: "User not found" });

        // Calculate leaderboard rank
        const allUsers = await User.collection.find({}).project({ discordId: 1, totalPoints: 1 }).toArray();
        allUsers.sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
        const rankIdx = allUsers.findIndex(u => u.discordId === user.discordId);
        const rank = (rankIdx !== -1 && (user.totalPoints || 0) > 0) ? rankIdx + 1 : null;

        const contributions = await Contribution.collection.find({ 
            submitterDiscordId: user.discordId, 
            status: 'approved' 
        }).sort({ createdAt: -1 }).toArray();

        // Join Game Data for Icons and Names
        const gameIds = [...new Set(contributions.map(c => c.gameId))];
        const games = await Game.collection.find({ id: { $in: gameIds } }).toArray();
        const gameMap = {};
        games.forEach(g => { gameMap[g.id] = g; });

        res.json({
            username: user.username,
            avatar: user.avatar,
            discordId: user.discordId,
            totalPoints: user.totalPoints || 0,
            gamePoints: user.gamePoints || {},
            rank,
            starredGames: user.starredGames || [],
            starredSubItems: user.starredSubItems || {},
            canvasNodes: user.canvasNodes || [],
            contributions: contributions.map(c => ({
                gameId: c.gameId,
                gameName: gameMap[c.gameId]?.name || c.gameId,
                gameIcon: gameMap[c.gameId]?.banner_url || '/Assets/placeholder.webp',
                category: c.itemCategory,
                action: c.actionType,
                points: getContributionPoints(c),
                commitMessage: c.data?.commitMessage || '',
                target: c.targetIdentifier || (c.data && (c.data.title || c.data.name || c.data.code)) || 'Approved Update',
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

// --- EXTERNAL GAME LOOKUP (SUPPORTS STEAM, APPLE APP STORE, OR BOTH) ---
app.get('/api/suggest/lookup', async (req, res) => {
    const term = (req.query.term || '').trim();
    const source = (req.query.source || 'both').toLowerCase(); // 'apple' | 'steam' | 'both'
    if (!term) return res.status(400).json({ error: "No search term provided" });

    try {
        const allGames = await Game.collection.find({}, { projection: { id: 1, name: 1, banner_url: 1 } }).toArray();
        const shouldCheckApple = source === 'apple' || source === 'both';
        const shouldCheckSteam = source === 'steam' || source === 'both';

        const [appleRes, steamSearchRes] = await Promise.allSettled([
            shouldCheckApple
                ? axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=10`, { timeout: 4500 })
                : Promise.resolve(null),
            shouldCheckSteam
                ? axios.get(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`, { timeout: 4500 })
                : Promise.resolve(null)
        ]);

        const appleResults = (appleRes.status === 'fulfilled' && appleRes.value?.data?.results) ? appleRes.value.data.results : [];
        const appleMatch = shouldCheckApple
            ? (findBestAppStoreMatch(appleResults, { id: '__lookup__', name: term }, allGames) || appleResults[0] || null)
            : null;

        const steamItems = (steamSearchRes.status === 'fulfilled' && steamSearchRes.value?.data?.items) ? steamSearchRes.value.data.items : [];
        const normTerm = normalizeGameTitle(term);
        const steamMatch = shouldCheckSteam
            ? (steamItems.find(item => normalizeGameTitle(item.name) === normTerm) ||
               steamItems.find(item => normalizeGameTitle(item.name).includes(normTerm)) ||
               steamItems[0])
            : null;

        let steamDetails = null;
        if (steamMatch && steamMatch.id) {
            try {
                const detailRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${steamMatch.id}&l=english`, { timeout: 4500 });
                if (detailRes.data && detailRes.data[steamMatch.id]?.success) {
                    steamDetails = detailRes.data[steamMatch.id].data;
                }
            } catch (e) {}
        }

        if (!appleMatch && !steamDetails) {
            return res.json({ found: false });
        }

        // If user explicitly chose 'steam' (or only Steam matched), return Steam data directly
        if ((source === 'steam' && steamDetails) || (!appleMatch && steamDetails)) {
            const steamGenres = (steamDetails.genres || []).map(g => g.description).filter(Boolean);
            const steamShots = (steamDetails.screenshots || []).slice(0, 4).map(s => s.path_thumbnail).filter(Boolean);
            const cleanDesc = (steamDetails.short_description || steamDetails.detailed_description || '')
                .replace(/<[^>]*>/g, '')
                .trim();

            // Use square library icon/header image from Steam
            const steamIcon = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${steamMatch.id}/header.jpg`;

            return res.json({
                found: true,
                source: 'Steam Store',
                platformTag: 'PC',
                name: steamDetails.name,
                developer: (steamDetails.developers && steamDetails.developers[0]) || (steamDetails.publishers && steamDetails.publishers[0]) || 'Unknown Developer',
                icon_url: steamDetails.header_image || steamIcon || (steamMatch && steamMatch.tiny_image),
                tags: ['PC', ...steamGenres],
                overview_text: cleanDesc,
                latest_version: null,
                last_major_update_date: null,
                latest_update_images: steamShots
            });
        }

        // Otherwise return Apple App Store data (marking PC+Mobile if Steam also matched the exact title)
        const alsoOnSteam = Boolean(steamDetails) && normalizeGameTitle(appleMatch.trackName) === normalizeGameTitle(steamDetails.name);
        const platformTag = alsoOnSteam ? 'PC+Mobile' : 'Mobile';
        const cleanGenres = (appleMatch.genres || []).filter(g => g !== 'Games' && g !== 'Entertainment');
        const majorUpdate = isMajorAppStoreUpdate(appleMatch);
        const shots = (Array.isArray(appleMatch.screenshotUrls) && appleMatch.screenshotUrls.length > 0)
            ? appleMatch.screenshotUrls.slice(0, 4)
            : (Array.isArray(appleMatch.ipadScreenshotUrls) ? appleMatch.ipadScreenshotUrls.slice(0, 4) : []);

        return res.json({
            found: true,
            source: alsoOnSteam ? 'Apple + Steam' : 'Apple App Store',
            platformTag,
            name: appleMatch.trackName,
            developer: appleMatch.artistName,
            icon_url: appleMatch.artworkUrl512,
            tags: [platformTag, ...cleanGenres],
            overview_text: appleMatch.description,
            latest_version: appleMatch.version || null,
            last_major_update_date: majorUpdate ? appleMatch.currentVersionReleaseDate : null,
            latest_update_images: shots
        });
    } catch (err) {
        console.error("External lookup error:", err);
        res.status(500).json({ error: "Failed to lookup game data." });
    }
});

// --- DYNAMIC OPEN GRAPH EMBED ROUTE FOR GAME PAGES ---
app.get('/games/:id', async (req, res) => {
    try {
        const gamePath = path.join(process.cwd(), 'public', 'game.html');
        let html = fs.readFileSync(gamePath, 'utf8');
        const cleanId = req.params.id.split('?')[0].split('#')[0]; 
        const game = await Game.collection.findOne({ id: cleanId });

        const escMeta = (str) => (str || '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        const title = game ? `Nurture | ${escMeta(game.name)} — Guides, Codes, Assets & Mods` : "Nurture | Game Hub";
        const rawDesc = game && game.overview_text 
            ? game.overview_text.replace(/\s+/g, ' ').trim().substring(0, 195) + '...'
            : `Explore community-curated guides, active redeem codes, raw assets, and mods for ${game ? game.name : 'games'} on Nurture.`;
        
        html = html
            .replace(/<title>.*?<\/title>/i, `<title>${title}</title>`)
            .replace(/content="__OG_TITLE__"/g, `content="${title}"`)
            .replace(/content="__OG_DESC__"/g, `content="${escMeta(rawDesc)}"`)
            .replace(/content="__OG_IMAGE__"/g, `content="${game?.banner_url || `https://${req.get('host')}/Assets/nurture_icon.webp`}"`)
            .replace(/content="__OG_URL__"/g, `content="https://${req.get('host')}${req.originalUrl}"`);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) { res.sendFile(path.join(process.cwd(), 'public', 'game.html')); }
});

app.get('/profile/:id', async (req, res) => {
    try {
        const profilePath = path.join(process.cwd(), 'public', 'profile.html');
        let html = fs.readFileSync(profilePath, 'utf8');
        const cleanId = req.params.id.split('?')[0].split('#')[0];
        
        let user = await User.collection.findOne({ discordId: cleanId });
        if (!user) user = await User.collection.findOne({ username: new RegExp(`^${cleanId}$`, 'i') });

        const escMeta = (str) => (str || '').toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
        const title = user ? `Nurture | ${escMeta(user.username)}'s Profile` : "Nurture | User Profile";
        
        html = html
            .replace(/<title>.*?<\/title>/i, `<title>${title}</title>`)
            .replace(/content="__OG_TITLE__"/g, `content="${title}"`)
            .replace(/content="__OG_DESC__"/g, `content="View user contributions, favorite games, and tools on Nurture."`)
            .replace(/content="__OG_IMAGE__"/g, `content="${user?.avatar ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.webp` : `https://${req.get('host')}/Assets/nurture_icon.webp`}"`)
            .replace(/content="__OG_URL__"/g, `content="https://${req.get('host')}${req.originalUrl}"`);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) { res.sendFile(path.join(process.cwd(), 'public', 'profile.html')); }
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