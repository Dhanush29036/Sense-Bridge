const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Preference = require('../models/Preference');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateToken = (userId) =>
    jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

const sendTokenResponse = (res, user, statusCode) => {
    const token = generateToken(user._id);
    res.status(statusCode).json({
        success: true,
        token,
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
    });
};

// ─── @route  POST /api/auth/register ─────────────────────────────────────────
// ─── @access Public
const register = async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body;

        // Check duplicate email
        const existing = await User.findOne({ email });
        if (existing) {
            return res.status(409).json({ success: false, message: 'Email already registered.' });
        }

        const user = await User.create({ name, email, password, role });

        // Seed default preferences for the new user
        await Preference.create({ user: user._id });

        sendTokenResponse(res, user, 201);
    } catch (err) {
        next(err);
    }
};

// ─── @route  POST /api/auth/login ────────────────────────────────────────────
// ─── @access Public
const login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // Explicitly select password (select: false on schema)
        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        if (!user.isActive) {
            return res.status(403).json({ success: false, message: 'Account is deactivated.' });
        }

        sendTokenResponse(res, user, 200);
    } catch (err) {
        next(err);
    }
};

// ─── @route  GET /api/auth/me ────────────────────────────────────────────────
// ─── @access Private
const getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user._id).populate('preferences');
        res.status(200).json({ success: true, data: user });
    } catch (err) {
        next(err);
    }
};

module.exports = { register, login, getMe };
