const mongoose = require('mongoose');

const contributionSchema = new mongoose.Schema({
    submitterDiscordId: { type: String, required: true },
    submitterUsername: { type: String, required: true },
    gameId: { type: String }, 
    itemCategory: { type: String, enum: ['Game', 'Guide', 'Asset', 'Community', 'Mod'], required: true },
    
    // What is the user trying to do?
    actionType: { type: String, enum: ['CREATE', 'EDIT', 'DELETE'], required: true },
    
    // If EDIT or DELETE, which item are they targeting?
    targetIdentifier: { type: String }, 
    
    data: { type: mongoose.Schema.Types.Mixed, required: true }, // The proposed new/edited data
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    submittedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Contribution', contributionSchema);