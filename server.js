const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const xss = require('xss');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("Connected to MongoDB Atlas");
}).catch((err) => {
    console.error("Database connection error:", err);
});

// Authetication Routes
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const User = require('./models/User'); // Import your User model

app.use(cookieParser()); // Allows Express to read incoming cookies

// 1. Send the user to Discord to log in
app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
    // We request 'identify' (for profile data) and 'guilds' (to see their servers)
    const scopes = 'identify guilds'; 
    
    const discordLoginUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${encodeURIComponent(scopes)}`;
    res.redirect(discordLoginUrl);
});

// 2. Handle the return from Discord
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided');

    try {
        // A. Exchange the code for an Access Token
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

        // B. Fetch their basic profile (Identify scope)
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const discordUser = userResponse.data;

        // C. Fetch their server list (Guilds scope)
        const guildsResponse = await axios.get('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        // D. Check if the Nurture Guild ID exists in their server list
        const isMember = guildsResponse.data.some(guild => guild.id === process.env.NURTURE_GUILD_ID);

        // E. Save or update the user in MongoDB
        let user = await User.findOne({ discordId: discordUser.id });
        if (user) {
            // Update existing user (their avatar or server status might have changed)
            user.username = discordUser.username;
            user.avatar = discordUser.avatar;
            user.isNurtureMember = isMember;
            await user.save();
        } else {
            // Create a brand new user
            user = await User.create({
                discordId: discordUser.id,
                username: discordUser.username,
                avatar: discordUser.avatar,
                isNurtureMember: isMember
            });
        }

        // F. Create a secure session token
        const sessionToken = jwt.sign(
            { userId: user._id, discordId: user.discordId, isNurtureMember: user.isNurtureMember }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' } // Session lasts 7 days
        );

        // G. Store the token in an HttpOnly cookie so the frontend can't be hacked for it
        res.cookie('nurture_session', sessionToken, { 
            httpOnly: true, 
            secure: process.env.NODE_ENV === 'production', // Use secure cookies on the live site
            maxAge: 7 * 24 * 60 * 60 * 1000 
        });

        // Redirect back to the homepage
        res.redirect('/');

    } catch (error) {
        console.error('OAuth Error:', error.response ? error.response.data : error.message);
        res.status(500).send('Authentication failed');
    }
});

// Check current user session
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

// Logout route
app.get('/auth/logout', (req, res) => {
    res.clearCookie('nurture_session');
    res.redirect('/');
});

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
        },
    },
    crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use('/Assets', express.static(path.join(__dirname, 'Assets'), {
    maxAge: '1d',
    etag: true
}));

// Import the game database
const rawGames = require('./data/games.json');

// Helper to check if a game has extended data
const hasGameData = (game) => {
    return !!(game.overview_text || game.guides || game.assets || game.communities || game.mods || game.trailer_id || game.ratings);
};

// Sort games: "Has Data" first, then Alphabetically
const validGames = rawGames.sort((a, b) => {
    const aData = hasGameData(a);
    const bData = hasGameData(b);
    
    if (aData && !bData) return -1;
    if (!aData && bData) return 1;
    
    return a.name.localeCompare(b.name);
});

// Input validation
const validateInput = {
    sanitizeString: (str) => xss(validator.escape(str || '')),
    isValidSearch: (term) => validator.isLength(term || '', { min: 1, max: 100 }),
    isValidGameName: (name) => validator.isLength(name || '', { min: 1, max: 100 })
};

// --- Public API Routes ---

// Get all games (paginated)
app.get('/api/games', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedGames = validGames.slice(startIndex, endIndex);

    res.json({
        games: paginatedGames,
        pagination: {
            page,
            limit,
            total: validGames.length,
            pages: Math.ceil(validGames.length / limit)
        }
    });
});

// Get game by ID
app.get('/api/games/:id', (req, res) => {
    const gameId = req.params.id; 
    
    const game = validGames.find(g => g.id === gameId);

    if (!game) {
        return res.status(404).json({ error: 'Game not found' });
    }

    res.json(game);
});

// Search games
app.get('/api/games/search/:term', (req, res) => {
    const searchTerm = req.params.term;
    
    if (!validateInput.isValidSearch(searchTerm)) {
        return res.status(400).json({ error: 'Invalid search term' });
    }

    const sanitizedTerm = validateInput.sanitizeString(searchTerm).toLowerCase();
    
    const results = validGames.filter(game => 
        game.name.toLowerCase().includes(sanitizedTerm) || 
        game.developer.toLowerCase().includes(sanitizedTerm)
    ).slice(0, 10);

    res.json(results);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        mode: 'local-memory'
    });
});

// Serve main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'Main Page', 'nurture.html'));
});

// Route for individual game pages and their sub-sections
app.get('/games/:gameId/:section?', (req, res) => {
    res.sendFile(path.join(__dirname, 'Main Page', 'game.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Export the app for Vercel Serverless, but keep listen() for local testing
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server running at http://localhost:${port}`);
    });
}

module.exports = app;