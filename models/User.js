const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    discordId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    avatar: { type: String },
    isNurtureMember: { type: Boolean, default: false },
    totalPoints: { type: Number, default: 0 },
    gamePoints: { type: Map, of: Number, default: {} }, 
    contributionStreak: { type: Number, default: 0 },
    lastContributionDate: { type: Date },
    starredGames: [{ type: String }],
    
    // Two-way mailbox system
    mailbox: [{
        messageId: { type: mongoose.Schema.Types.ObjectId, auto: true },
        direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], required: true }, // INBOUND = Admin to User, OUTBOUND = User to Admin
        subject: { type: String, required: true },
        content: { type: String, required: true },
        date: { type: Date, default: Date.now },
        read: { type: Boolean, default: false }
    }]
});

module.exports = mongoose.model('User', userSchema);