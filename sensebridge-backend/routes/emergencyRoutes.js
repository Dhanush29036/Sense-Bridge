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


// ── Email transport (lazy, reused) ─────────────────────────────────────────
let _mailer = null;
const getMailer = () => {
    if (_mailer) return _mailer;
    const { EMAIL_USER, EMAIL_PASS } = process.env;
    if (!EMAIL_USER || !EMAIL_PASS ||
        EMAIL_USER === 'your_gmail@gmail.com') return null;
    try {
        const nodemailer = require('nodemailer');
        _mailer = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: EMAIL_USER, pass: EMAIL_PASS },
        });
        return _mailer;
    } catch {
        console.warn('[Emergency] nodemailer not available');
        return null;
    }
};

// ─── POST /api/emergency/sos ─────────────────────────────────────────────────
/**
 * Main SOS dispatch:
 *  1. Log the event to DB
 *  2. Fetch user's emergency contacts
 *  3. Try SMS (Twilio) + email (nodemailer) for each contact
 *  4. Return per-contact dispatch results
 *
 * Body: { userId, source, latitude?, longitude?, timestamp }
 */
router.post('/sos', auth, async (req, res) => {
    try {
        const { userId, source = 'button', latitude, longitude, timestamp, message } = req.body;

        if (!userId) return res.status(400).json({ success: false, message: 'userId required' });

        const user = await User.findById(userId).select('name role email');
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

        // 2. Build location link + message text
        const mapsLink = (latitude && longitude)
            ? `https://maps.google.com/?q=${latitude},${longitude}`
            : null;

        const timeStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const smsBody =
            `🚨 EMERGENCY ALERT from ${user.name || 'SenseBridge user'}\n` +
            `Source: ${source}\n` +
            `Location: ${mapsLink || 'unavailable'}\n` +
            `Time: ${timeStr}`;

        const htmlBody = `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#ff4b6e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
                <h2 style="margin:0">&#x1F6A8; Emergency Alert &#x2014; SenseBridge</h2>
              </div>
              <div style="padding:20px 24px;background:#fff;border:1px solid #eee;border-radius:0 0 8px 8px">
                <p><strong>${user.name || 'A SenseBridge user'}</strong> has triggered an emergency SOS alert.</p>

                ${message ? `<div style="background:#fff5f5;border-left:4px solid #ff4b6e;padding:12px 16px;border-radius:4px;margin:12px 0;font-size:0.95rem;white-space:pre-wrap;color:#333">${message}</div>` : ''}

                <table style="width:100%;border-collapse:collapse;margin-top:12px">
                  <tr><td style="padding:6px 0;color:#555;width:100px"><strong>Source</strong></td><td>${source}</td></tr>
                  <tr><td style="padding:6px 0;color:#555"><strong>Time</strong></td><td>${timeStr}</td></tr>
                  <tr><td style="padding:6px 0;color:#555;vertical-align:top"><strong>Location</strong></td>
                      <td>${mapsLink
                            ? `<a href="${mapsLink}" style="color:#6c63ff;word-break:break-all">${mapsLink}</a>`
                            : '<span style="color:#999">GPS not available &mdash; contact immediately</span>'}</td></tr>
                </table>

                ${mapsLink ? `<a href="${mapsLink}" style="display:inline-block;margin-top:16px;padding:10px 22px;background:#ff4b6e;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:0.95rem">&#x1F4CD; Open on Google Maps</a>` : ''}

                <hr style="margin:20px 0;border:none;border-top:1px solid #eee"/>
                <p style="font-size:12px;color:#999">Sent automatically by SenseBridge Assistive System</p>
              </div>
            </div>`;

        // 3. Send to each contact via all available channels
        const contacts = await EmergencyContact.find({ user: userId });
        const twilioClient = getTwilioClient();
        const mailer       = getMailer();
        const results = [];

        for (const contact of contacts) {
            const result = { name: contact.name, phone: contact.phone, email: contact.email, smsSent: false, emailSent: false, error: null };

            // ── Twilio SMS ──────────────────────────────────────────────
            if (twilioClient && contact.phone) {
                try {
                    await twilioClient.messages.create({
                        body: smsBody,
                        from: process.env.TWILIO_PHONE,
                        to:   contact.phone,
                    });
                    result.smsSent = true;
                } catch (e) {
                    console.error(`[SMS] ${contact.phone}:`, e.message);
                    result.error = e.message;
                }
            }

            // ── Email (nodemailer) ──────────────────────────────────────
            if (mailer && contact.email) {
                try {
                    await mailer.sendMail({
                        from:    process.env.EMAIL_FROM || process.env.EMAIL_USER,
                        to:      contact.email,
                        subject: `🚨 Emergency Alert from ${user.name || 'SenseBridge'}`,
                        text:    smsBody,
                        html:    htmlBody,
                    });
                    result.emailSent = true;
                } catch (e) {
                    console.error(`[Email] ${contact.email}:`, e.message);
                    result.error = result.error ? result.error + '; ' + e.message : e.message;
                }
            }

            results.push(result);
        }

        const smsSentCount   = results.filter(r => r.smsSent).length;
        const emailSentCount = results.filter(r => r.emailSent).length;
        const totalNotified  = results.filter(r => r.smsSent || r.emailSent).length;

        res.json({
            success: true,
            eventId: log._id,
            contactsNotified: totalNotified,
            smsSentCount,
            emailSentCount,
            contacts: results,
            mapsLink,
            twilioConfigured: !!twilioClient,
            emailConfigured:  !!mailer,
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
