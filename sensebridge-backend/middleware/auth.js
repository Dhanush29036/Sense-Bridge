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

    if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Attach fresh user from DB (ensures user still exists / is active)
        req.user = await User.findById(decoded.id).select('-password');

        if (!req.user || !req.user.isActive) {
            return res.status(401).json({ success: false, message: 'User not found or deactivated.' });
        }

        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Token invalid or expired.' });
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
