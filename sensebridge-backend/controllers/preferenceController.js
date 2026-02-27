const Preference = require('../models/Preference');

// ─── @route  GET /api/preferences ────────────────────────────────────────────
// ─── @access Private
const getPreferences = async (req, res, next) => {
    try {
        const prefs = await Preference.findOne({ user: req.user._id });
        if (!prefs) {
            return res.status(404).json({ success: false, message: 'Preferences not found.' });
        }
        res.status(200).json({ success: true, data: prefs });
    } catch (err) {
        next(err);
    }
};

// ─── @route  PUT /api/preferences ────────────────────────────────────────────
// ─── @access Private
const updatePreferences = async (req, res, next) => {
    try {
        // Allowed update fields — prevents mass-assignment
        const { language, voiceSpeed, alertType, features, accessibility } = req.body;
        const allowed = { language, voiceSpeed, alertType, features, accessibility };
        // Remove undefined keys
        Object.keys(allowed).forEach((k) => allowed[k] === undefined && delete allowed[k]);

        const prefs = await Preference.findOneAndUpdate(
            { user: req.user._id },
            { $set: allowed },
            { new: true, runValidators: true, upsert: true }
        );

        res.status(200).json({ success: true, data: prefs });
    } catch (err) {
        next(err);
    }
};

module.exports = { getPreferences, updatePreferences };
