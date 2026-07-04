const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const xss = require('xss');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            // Allow GSAP to load from cdnjs
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            // Allow images from https and http (for your googleusercontent placeholders)
            imgSrc: ["'self'", "data:", "https:", "http:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            // Allow YouTube iframes for game trailers
            frameSrc: ["'self'", "https://www.youtube.com"],
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

// Serve static files from your existing structure
app.use('/Assets', express.static(path.join(__dirname, 'Assets'), {
    maxAge: '1d',
    etag: true
}));

// Import the game database
const validGames = require('./data/games.json');

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
    const gameId = req.params.id; // e.g., 'honkai-star-rail'
    
    // Search the database using the new ID field
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
    // We serve the same HTML shell for all game pages and sub-sections.
    // The frontend JS will figure out what to display based on the URL.
    res.sendFile(path.join(__dirname, 'Main Page', 'game.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Running in local-memory mode (No Database)`);
});