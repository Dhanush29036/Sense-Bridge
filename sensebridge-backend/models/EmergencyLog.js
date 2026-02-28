/**
 * EmergencyLog Mongoose Model
 * ===========================
 * Stores every SOS and fall event with GPS, source, and dispatch status.
 */

const mongoose = require('mongoose');

const EmergencyLogSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    source: {
        type: String,
        enum: ['shake', 'voice_command', 'power_button', 'button', 'fall_detector'],
        default: 'button',
    },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    status: {
        type: String,
        enum: ['armed', 'dispatched', 'cancelled'],
        default: 'dispatched',
    },
    contactsNotified: { type: Number, default: 0 },
    cancelledAt: { type: Date, default: null },
    timestamp: { type: Date, default: Date.now },
}, {
    timestamps: true,
});

// Auto-delete logs older than 1 year (data retention)
EmergencyLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('EmergencyLog', EmergencyLogSchema);
