const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    avatar: { type: String },
    isNurtureMember: { type: Boolean, default: false },
    totalPoints: { type: Number, default: 0 },
    joinedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);