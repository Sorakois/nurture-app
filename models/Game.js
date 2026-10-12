const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    developer: { type: String },
    banner_url: { type: String },
    redeem_codes_url: { type: String },
    overview_text: { type: String },
    new_player_video_id: { type: String },
    tags: [{ type: String }],
    ratings: {
        age: String,
        f2p: String,
        afk: String,
        story: String,
        gameplay: String,
        overall: String
    },
    mini_focuses: Array,
    guides: Array,
    assets: Array,
    communities: Array,
    mods: Array
});

module.exports = mongoose.model('Game', gameSchema);