const mongoose = require('mongoose');

const contributionSchema = new mongoose.Schema({
    gameId: { type: String, required: true },
    submitterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['guide', 'asset', 'community', 'mod', 'redeem_code'], required: true },
    content: { type: Object, required: true }, // The actual JSON data being submitted
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    submittedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Contribution', contributionSchema);