const mongoose = require('mongoose');
const Game = require('./models/Game');
require('dotenv').config();

const tagMap = {
    'arknights': ['Tower Defense', 'RPG'],
    'genshin-impact': ['RPG', 'Action'],
    'honkai-star-rail': ['RPG', 'Turn-Based'], 
    'zenless-zone-zero': ['Action', 'RPG'],
    'wuthering-waves': ['Action', 'RPG'],
    'hatsune-miku-colorful-stage': ['Rhythm'],
    'cookierun-kingdom': ['RPG', 'City Builder']
};

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const games = await Game.find({});
    
    for (let game of games) {
        // Fallback to RPG instead of Gacha if not mapped
        game.tags = tagMap[game.id] || ['RPG'];
        await game.save();
    }
    console.log("All games successfully tagged!");
    process.exit(0);
}
run();