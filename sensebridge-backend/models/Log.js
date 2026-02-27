const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        // Category of AI event that generated this log
        eventType: {
            type: String,
            enum: {
                values: [
                    'object_detection',   // YOLO
                    'gesture',            // MediaPipe / custom gesture model
                    'speech_to_text',     // Whisper
                    'text_to_speech',     // TTS engine
                    'navigation_alert',   // custom safety alerts
                    'system',             // app lifecycle / errors
                ],
                message: 'Invalid eventType',
            },
            required: true,
        },
        // Human-readable summary of the event
        message: {
            type: String,
            required: [true, 'Log message is required'],
            maxlength: [500, 'Log message cannot exceed 500 characters'],
        },
        // Flexible payload for AI metadata (bounding boxes, confidence, transcription, etc.)
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        // AI model confidence score (0-1), if applicable
        confidence: {
            type: Number,
            min: 0,
            max: 1,
        },
        severity: {
            type: String,
            enum: ['info', 'warning', 'critical'],
            default: 'info',
        },
    },
    {
        timestamps: true,
        // Automatically expire logs after 90 days
        // Requires: db.logs.createIndex({ "createdAt": 1 }, { expireAfterSeconds: 7776000 })
        // OR use mongoose TTL index below:
    }
);

// TTL index: auto-delete logs older than 90 days
logSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

// Compound index for efficient queries: "get all object_detection logs for user X after date Y"
logSchema.index({ user: 1, eventType: 1, createdAt: -1 });

module.exports = mongoose.model('Log', logSchema);
