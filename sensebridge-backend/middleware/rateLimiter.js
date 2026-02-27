const rateLimit = require('express-rate-limit');

/**
 * General API rate limiter.
 * Applied to /api/* in server.js.
 */
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: true,  // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many requests from this IP. Please try again later.',
    },
});

/**
 * Tighter limiter for auth endpoints (register / login).
 */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many auth attempts. Please wait 15 minutes.',
    },
});

module.exports = { apiLimiter, authLimiter };
