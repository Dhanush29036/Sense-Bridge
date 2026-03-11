/**
 * metrics.js — Prometheus instrumentation for SenseBridge Express backend
 *
 * Exposes:
 *   http_requests_total          counter  { method, route, status_code }
 *   http_request_duration_seconds histogram { method, route, status_code }
 *   http_active_requests         gauge
 *   sensebridge_sos_total        counter  (incremented when /emergency/sos is called)
 *   sensebridge_registered_users gauge    (polled once per minute from DB)
 */

const client = require('prom-client');

// ── Default metrics (CPU, memory, GC, event loop) ─────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'sensebridge_node_' });

// ── HTTP counters & histogram ──────────────────────────────────────────────────
const httpRequestTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [register],
});

const httpActiveRequests = new client.Gauge({
    name: 'http_active_requests',
    help: 'Number of currently active HTTP requests',
    registers: [register],
});

// ── SenseBridge-specific business metrics ────────────────────────────────────
const sosTotal = new client.Counter({
    name: 'sensebridge_sos_total',
    help: 'Total SOS alerts triggered',
    registers: [register],
});

const registeredUsers = new client.Gauge({
    name: 'sensebridge_registered_users',
    help: 'Total registered users',
    registers: [register],
});

const activeUsers = new client.Gauge({
    name: 'sensebridge_active_users',
    help: 'Total active (non-deactivated) users',
    registers: [register],
});

// ── Normalize route path to avoid high-cardinality label explosion ────────────
const ROUTE_PATTERNS = [
    [/^\/api\/auth\/.+/,              '/api/auth/:action'],
    [/^\/api\/emergency\/sos/,        '/api/emergency/sos'],
    [/^\/api\/emergency\/history\/.+/,'/api/emergency/history/:uid'],
    [/^\/api\/emergency\/cancel\/.+/, '/api/emergency/cancel/:eid'],
    [/^\/api\/emergency-contacts\/.+/,'/api/emergency-contacts/:id'],
    [/^\/api\/emergency-contacts/,    '/api/emergency-contacts'],
    [/^\/api\/admin\/users\/.+/,      '/api/admin/users/:id'],
    [/^\/api\/admin\/.+/,             '/api/admin/:action'],
    [/^\/api\/logs/,                  '/api/logs'],
    [/^\/api\/preferences/,           '/api/preferences'],
    [/^\/api\/ai\/.+/,                '/api/ai/:action'],
    [/^\/metrics/,                    '/metrics'],
    [/^\/health/,                     '/health'],
];

const normalizeRoute = (path) => {
    for (const [re, label] of ROUTE_PATTERNS) {
        if (re.test(path)) return label;
    }
    return path.length > 80 ? '/other' : path;
};

// ── Express middleware ────────────────────────────────────────────────────────
const metricsMiddleware = (req, res, next) => {
    httpActiveRequests.inc();
    const end = httpRequestDuration.startTimer();
    const route = normalizeRoute(req.path);

    res.on('finish', () => {
        const labels = { method: req.method, route, status_code: res.statusCode };
        httpRequestTotal.inc(labels);
        end(labels);
        httpActiveRequests.dec();

        // Track SOS events
        if (req.method === 'POST' && req.path === '/api/emergency/sos' && res.statusCode < 400) {
            sosTotal.inc();
        }
    });

    next();
};

// ── Periodically refresh user gauges from the database ───────────────────────
let _User = null;
const refreshUserGauges = async () => {
    try {
        if (!_User) _User = require('./models/User');
        const [total, active] = await Promise.all([
            _User.countDocuments(),
            _User.countDocuments({ isActive: true }),
        ]);
        registeredUsers.set(total);
        activeUsers.set(active);
    } catch { /* DB might not be ready yet on first tick */ }
};

// Start polling after a 5-second delay (give Mongoose time to connect)
setTimeout(() => {
    refreshUserGauges();
    setInterval(refreshUserGauges, 60_000); // refresh every 60s
}, 5000);

module.exports = { register, metricsMiddleware };
