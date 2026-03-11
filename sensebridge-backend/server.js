'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

const connectDB = require('./config/db');
const { apiLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// ─── Route imports ─────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const preferenceRoutes = require('./routes/preferenceRoutes');
const emergencyContactRoutes = require('./routes/emergencyContactRoutes');
const logRoutes = require('./routes/logRoutes');
const emergencyRoutes = require('./routes/emergencyRoutes');
const aiRoutes = require('./routes/aiRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { register: metricsRegistry, metricsMiddleware } = require('./middleware/metrics');

// ─── Database ──────────────────────────────────────────────────────────────────
connectDB();

const app = express();

// ─── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [];

app.use(
    cors({
        origin: (origin, callback) => {
            // Allow requests with no origin (mobile apps, Postman, server-to-server)
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error(`CORS: Origin '${origin}' not allowed.`));
            }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    })
);

// ─── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' })); // prevent large payload attacks
app.use(express.urlencoded({ extended: true }));

// ─── HTTP request logger ───────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Prometheus metrics middleware (instrument every request) ─────────────────
app.use(metricsMiddleware);

// ─── Global rate limiter ───────────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ─── Prometheus metrics endpoint (/metrics) ────────────────────────────────────
// Prometheus scrapes this endpoint. Restrict access to localhost in prod.
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
    } catch (err) {
        res.status(500).end(err.message);
    }
});

// ─── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/preferences', preferenceRoutes);
app.use('/api/emergency-contacts', emergencyContactRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/emergency', emergencyRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
});

// ─── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ─── Start server ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 5000;
const server = app.listen(PORT, () => {
    console.log(`🚀  SenseBridge API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

// ─── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = (signal) => {
    console.log(`\n${signal} received — shutting down gracefully...`);
    server.close(() => {
        console.log('🛑  HTTP server closed.');
        process.exit(0);
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    server.close(() => process.exit(1));
});
