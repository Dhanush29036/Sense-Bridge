const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Name is required'],
            trim: true,
            maxlength: [100, 'Name cannot exceed 100 characters'],
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
            minlength: [8, 'Password must be at least 8 characters'],
            select: false, // never return password field by default
        },
        role: {
            type: String,
            enum: {
                values: ['blind', 'deaf', 'mute', 'mixed'],
                message: 'Role must be one of: blind, deaf, mute, mixed',
            },
            required: [true, 'Role is required'],
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        isAdmin: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true, // createdAt, updatedAt
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// ─── Virtual: populate preferences inline ────────────────────────────────────
userSchema.virtual('preferences', {
    ref: 'Preference',
    localField: '_id',
    foreignField: 'user',
    justOne: true,
});

// ─── Pre-save hook: hash password ─────────────────────────────────────────────
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
});

// ─── Instance method: compare password ───────────────────────────────────────
userSchema.methods.matchPassword = async function (enteredPassword) {
    return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
