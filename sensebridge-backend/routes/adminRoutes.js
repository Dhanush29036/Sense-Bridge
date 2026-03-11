/**
 * Admin Routes — SenseBridge
 * All routes require JWT auth + isAdmin flag.
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const User          = require('../models/User');
const EmergencyLog  = require('../models/EmergencyLog');
const EmergencyContact = require('../models/EmergencyContact');

// ── isAdmin guard ─────────────────────────────────────────────────────────────
const isAdmin = (req, res, next) => {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    next();
};

// All admin routes require auth + isAdmin
router.use(protect, isAdmin);

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
    try {
        const [
            totalUsers,
            activeUsers,
            blindCount,
            deafCount,
            muteCount,
            mixedCount,
            adminCount,
            totalSOS,
            recentSOS,
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ isActive: true }),
            User.countDocuments({ role: 'blind' }),
            User.countDocuments({ role: 'deaf' }),
            User.countDocuments({ role: 'mute' }),
            User.countDocuments({ role: 'mixed' }),
            User.countDocuments({ isAdmin: true }),
            EmergencyLog.countDocuments(),
            EmergencyLog.countDocuments({
                timestamp: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }),
        ]);

        res.json({
            success: true,
            stats: {
                users: { total: totalUsers, active: activeUsers, admin: adminCount },
                byRole: { blind: blindCount, deaf: deafCount, mute: muteCount, mixed: mixedCount },
                sos:   { total: totalSOS, last24h: recentSOS },
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
    try {
        const users = await User.find()
            .select('-password')
            .sort({ createdAt: -1 })
            .lean();

        // Attach SOS count per user
        const sosMap = await EmergencyLog.aggregate([
            { $group: { _id: '$user', count: { $sum: 1 }, last: { $max: '$timestamp' } } }
        ]);
        const sosById = {};
        sosMap.forEach(s => { sosById[s._id.toString()] = s; });

        const enriched = users.map(u => ({
            ...u,
            sosCount: sosById[u._id.toString()]?.count ?? 0,
            lastSOS:  sosById[u._id.toString()]?.last  ?? null,
        }));

        res.json({ success: true, count: enriched.length, users: enriched });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── GET /api/admin/sos-events ────────────────────────────────────────────────
router.get('/sos-events', async (req, res) => {
    try {
        const events = await EmergencyLog.find()
            .sort({ timestamp: -1 })
            .limit(50)
            .populate('user', 'name email role')
            .lean();
        res.json({ success: true, count: events.length, events });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── PATCH /api/admin/users/:id/toggle-active ─────────────────────────────────
router.patch('/users/:id/toggle-active', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.isAdmin && user._id.toString() !== req.user._id.toString()) {
            return res.status(400).json({ success: false, message: 'Cannot deactivate another admin.' });
        }
        user.isActive = !user.isActive;
        await user.save();
        res.json({ success: true, isActive: user.isActive });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ─── PATCH /api/admin/users/:id/toggle-admin ──────────────────────────────────
router.patch('/users/:id/toggle-admin', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        user.isAdmin = !user.isAdmin;
        await user.save();
        res.json({ success: true, isAdmin: user.isAdmin });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
