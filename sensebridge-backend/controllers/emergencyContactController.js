const EmergencyContact = require('../models/EmergencyContact');

const MAX_CONTACTS = 5;

// ─── @route  GET /api/emergency-contacts ─────────────────────────────────────
// ─── @access Private
const getContacts = async (req, res, next) => {
    try {
        const contacts = await EmergencyContact.find({ user: req.user._id }).sort('-isPrimary');
        res.status(200).json({ success: true, count: contacts.length, data: contacts });
    } catch (err) {
        next(err);
    }
};

// ─── @route  POST /api/emergency-contacts ────────────────────────────────────
// ─── @access Private
const addContact = async (req, res, next) => {
    try {
        const count = await EmergencyContact.countDocuments({ user: req.user._id });
        if (count >= MAX_CONTACTS) {
            return res.status(400).json({
                success: false,
                message: `You can store a maximum of ${MAX_CONTACTS} emergency contacts.`,
            });
        }

        const contact = await EmergencyContact.create({ ...req.body, user: req.user._id });
        res.status(201).json({ success: true, data: contact });
    } catch (err) {
        next(err);
    }
};

// ─── @route  PUT /api/emergency-contacts/:id ─────────────────────────────────
// ─── @access Private
const updateContact = async (req, res, next) => {
    try {
        const contact = await EmergencyContact.findOne({ _id: req.params.id, user: req.user._id });
        if (!contact) {
            return res.status(404).json({ success: false, message: 'Emergency contact not found.' });
        }

        const { name, phone, relationship, isPrimary, notifyOnAlert } = req.body;
        // Only update provided fields
        if (name !== undefined) contact.name = name;
        if (phone !== undefined) contact.phone = phone;
        if (relationship !== undefined) contact.relationship = relationship;
        if (isPrimary !== undefined) contact.isPrimary = isPrimary;
        if (notifyOnAlert !== undefined) contact.notifyOnAlert = notifyOnAlert;

        await contact.save();
        res.status(200).json({ success: true, data: contact });
    } catch (err) {
        next(err);
    }
};

// ─── @route  DELETE /api/emergency-contacts/:id ──────────────────────────────
// ─── @access Private
const deleteContact = async (req, res, next) => {
    try {
        const contact = await EmergencyContact.findOne({ _id: req.params.id, user: req.user._id });
        if (!contact) {
            return res.status(404).json({ success: false, message: 'Emergency contact not found.' });
        }

        await contact.deleteOne();
        res.status(200).json({ success: true, message: 'Contact removed.' });
    } catch (err) {
        next(err);
    }
};

module.exports = { getContacts, addContact, updateContact, deleteContact };
