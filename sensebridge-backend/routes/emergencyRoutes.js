/**
 * Emergency Routes — SenseBridge Backend
 * ========================================
 * Handles SOS dispatch, GPS logging, SMS-to-contacts, and emergency history.
 *
 * Routes:
 *   POST /api/emergency/sos          — Main SOS trigger endpoint
 *   POST /api/emergency/sensor       — Inertial sensor feed (fall detection bridge)
 *   GET  /api/emergency/history/:uid — User's emergency event log
 *   PUT  /api/emergency/cancel/:eid  — Cancel a pending alert
 */

const express = require('express');
const router = express.Router();
const { protect: auth } = require('../middleware/auth');
const EmergencyLog = require('../models/EmergencyLog');
const EmergencyContact = require('../models/EmergencyContact');
const User = require('../models/User');

// Twilio is optional — only loaded when credentials are present
// Install with: npm install twilio
const getTwilioClient = () => {
    if (!process.env.TWILIO_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
    try {
        // eslint-disable-next-line import/no-extraneous-dependencies
        const Twilio = require('twilio'); // eslint-disable-line global-require
        return Twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
    } catch {
        console.warn('[Emergency] twilio package not installed — SMS skipped.');
        return null;
    }
};


// ─── POST /api/emergency/sos ─────────────────────────────────────────────────
/**
 * Main SOS dispatch:
 *  1. Log the event to DB
 *  2. Fetch user's emergency contacts
 *  3. Send SMS with Google Maps link to each contact
 *  4. Return dispatch summary
 *
 * Body: { userId, source, latitude?, longitude?, timestamp }
 */
router.post('/sos', auth, async (req, res) => {
    try {
        const { userId, source = 'button', latitude, longitude, timestamp } = req.body;

        if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

        const user = await User.findById(userId).select('name role');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // 1. Log event
        const log = await EmergencyLog.create({
            user: userId,
            source,
            latitude,
            longitude,
            timestamp: timestamp ? new Date(timestamp * 1000) : new Date(),
            status: 'dispatched',
        });

        // 2. Build location link
        const mapsLink = (latitude && longitude)
            ? `https://maps.google.com/?q=${latitude},${longitude}`
            : 'Location unavailable';

        const message =
            `🚨 EMERGENCY ALERT from ${user.name || 'SenseBridge user'}\n` +
            `Source: ${source}\n` +
            `Location: ${mapsLink}\n` +
            `Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

        // 3. Fetch contacts and send SMS
        const contacts = await EmergencyContact.find({ user: userId });
        const twilioClient = getTwilioClient();
        const results = [];

        for (const contact of contacts) {
            let smsSent = false;
            if (twilioClient && contact.phone) {
                try {
                    await twilioClient.messages.create({
                        body: message,
                        from: process.env.TWILIO_PHONE,
                        to: contact.phone,
                    });
                    smsSent = true;
                } catch (smsErr) {
                    console.error(`[SMS] Failed for ${contact.phone}:`, smsErr.message);
                }
            }
            results.push({ name: contact.name, phone: contact.phone, smsSent });
        }

        res.json({
            success: true,
            eventId: log._id,
            contactsNotified: results.filter(r => r.smsSent).length,
            contacts: results,
            mapsLink,
        });

    } catch (err) {
        console.error('[Emergency SOS]', err);
        res.status(500).json({ success: false, message: 'Emergency dispatch failed' });
    }
});


// ─── POST /api/emergency/sensor ─────────────────────────────────────────────
/**
 * Inertial sensor bridge — Android pushes accelerometer+gyroscope samples here.
 * They are forwarded to the Fall Detector via a lightweight in-memory state.
 * Body: { userId, ax, ay, az, gx, gy, gz, ts }
 */
router.post('/sensor', auth, (req, res) => {
    // In production, forward to a WebSocket or SSE channel feeding FallDetector.
    // Here we acknowledge receipt; the fall detection logic runs in the Python service.
    const { ax, ay, az } = req.body;
    if (ax === undefined) return res.status(400).json({ message: 'ax/ay/az required' });
    res.json({ success: true, received: true });
});


// ─── GET /api/emergency/history/:uid ─────────────────────────────────────────
router.get('/history/:uid', auth, async (req, res) => {
    try {
        const logs = await EmergencyLog
            .find({ user: req.params.uid })
            .sort({ timestamp: -1 })
            .limit(20)
            .select('source latitude longitude timestamp status');
        res.json({ success: true, count: logs.length, logs });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ─── PUT /api/emergency/cancel/:eid ──────────────────────────────────────────
router.put('/cancel/:eid', auth, async (req, res) => {
    try {
        const log = await EmergencyLog.findByIdAndUpdate(
            req.params.eid,
            { status: 'cancelled', cancelledAt: new Date() },
            { new: true }
        );
        if (!log) return res.status(404).json({ message: 'Event not found' });
        res.json({ success: true, message: 'Emergency alert cancelled', log });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


module.exports = router;
