const mongoose = require('mongoose');

const preferenceSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true, // one preference doc per user
        },
        language: {
            type: String,
            default: 'en',
            trim: true,
        },
        voiceSpeed: {
            type: Number,
            default: 1.0,
            min: [0.5, 'Voice speed cannot be below 0.5'],
            max: [3.0, 'Voice speed cannot exceed 3.0'],
        },
        alertType: {
            type: String,
            enum: {
                values: ['sound', 'vibration', 'visual', 'all'],
                message: 'alertType must be one of: sound, vibration, visual, all',
            },
            default: 'all',
        },
        // AI-specific feature toggles
        features: {
            objectDetection: { type: Boolean, default: true },
            gestureRecognition: { type: Boolean, default: false },
            speechToText: { type: Boolean, default: true },
            textToSpeech: { type: Boolean, default: true },
        },
        // High-contrast / large text accessibility settings
        accessibility: {
            highContrast: { type: Boolean, default: false },
            largeText: { type: Boolean, default: false },
            fontSize: { type: Number, default: 14, min: 10, max: 32 },
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('Preference', preferenceSchema);
