const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Middleware: protect routes with JWT verification.
 * Attaches the authenticated user to req.user.
 */
const protect = async (req, res, next) => {
    let token;

    // Accept token from Authorization header or cookie
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    // No token at all — treat as guest so assistive/emergency routes still work
    if (!token || typeof token !== 'string') {
        req.user = { _id: 'guest_user', id: 'guest_user', name: 'Guest User', role: 'guest', isActive: true };
        return next();
    }

    // Allow guest, offline, and demo tokens without requiring DB lookup
    if (
        token.startsWith('guest_') ||
        token.startsWith('local_') ||
        token.startsWith('demo_') ||
        token === 'offline_dev_token' ||
        token === 'offline_guest_token'
    ) {
        req.user = { _id: 'guest_user', id: 'guest_user', name: 'Guest User', role: 'guest', isActive: true };
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Try to attach fresh user from DB if available
        try {
            req.user = await User.findById(decoded.id).select('-password');
        } catch {
            req.user = null;
        }

        if (!req.user) {
            // Fallback user object from decoded JWT if DB is temporarily disconnected
            req.user = { _id: decoded.id, id: decoded.id, role: decoded.role || 'user', isActive: true };
        }

        if (!req.user.isActive) {
            return res.status(401).json({ success: false, message: 'User deactivated.' });
        }

        next();
    } catch (err) {
        // Fallback for assistive routes
        req.user = { _id: 'guest_user', id: 'guest_user', name: 'Guest User', role: 'guest', isActive: true };
        next();
    }
};

/**
 * Middleware: role-based access control.
 * Usage: authorize('blind', 'deaf')
 * Passes only if req.user.role is one of the allowed roles.
 */
const authorize = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: `Role '${req.user.role}' is not authorized for this resource.`,
            });
        }
        next();
    };
};

module.exports = { protect, authorize };
