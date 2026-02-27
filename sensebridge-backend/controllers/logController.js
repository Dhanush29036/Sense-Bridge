const Log = require('../models/Log');

// ─── @route  GET /api/logs ────────────────────────────────────────────────────
// ─── @access Private
// ─── @query  eventType, severity, limit (default 50), page (default 1)
const getLogs = async (req, res, next) => {
    try {
        const { eventType, severity, limit = 50, page = 1 } = req.query;
        const filter = { user: req.user._id };
        if (eventType) filter.eventType = eventType;
        if (severity) filter.severity = severity;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [logs, total] = await Promise.all([
            Log.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
            Log.countDocuments(filter),
        ]);

        res.status(200).json({
            success: true,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
            data: logs,
        });
    } catch (err) {
        next(err);
    }
};

// ─── @route  POST /api/logs ───────────────────────────────────────────────────
// ─── @access Private (typically called by AI service layer)
const createLog = async (req, res, next) => {
    try {
        const { eventType, message, metadata, confidence, severity } = req.body;
        const log = await Log.create({
            user: req.user._id,
            eventType,
            message,
            metadata,
            confidence,
            severity,
        });
        res.status(201).json({ success: true, data: log });
    } catch (err) {
        next(err);
    }
};

// ─── @route  DELETE /api/logs ─────────────────────────────────────────────────
// ─── @access Private — clear all logs for current user
const clearLogs = async (req, res, next) => {
    try {
        const result = await Log.deleteMany({ user: req.user._id });
        res.status(200).json({ success: true, deleted: result.deletedCount });
    } catch (err) {
        next(err);
    }
};

module.exports = { getLogs, createLog, clearLogs };
