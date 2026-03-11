const mongoose = require('mongoose');

const emergencyContactSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        name: {
            type: String,
            required: [true, 'Contact name is required'],
            trim: true,
            maxlength: [100, 'Name cannot exceed 100 characters'],
        },
        phone: {
            type: String,
            trim: true,
            match: [/^\+?[1-9]\d{1,14}$/, 'Please provide a valid phone (E.164 format)'],
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
            match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email'],
        },
        relationship: {
            type: String,
            trim: true,
            maxlength: [50, 'Relationship label cannot exceed 50 characters'],
        },
        isPrimary: {
            type: Boolean,
            default: false,
        },
        notifyOnAlert: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

// A user can have at most 5 emergency contacts (enforced at controller level)
// Index for fast lookup by user
emergencyContactSchema.index({ user: 1 });

module.exports = mongoose.model('EmergencyContact', emergencyContactSchema);
