const express = require('express');
const { body } = require('express-validator');
const {
    getContacts,
    addContact,
    updateContact,
    deleteContact,
} = require('../controllers/emergencyContactController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const contactRules = [
    body('name').trim().notEmpty().withMessage('Contact name is required').isLength({ max: 100 }),
    body('phone')
        .notEmpty()
        .withMessage('Phone number is required')
        .matches(/^\+?[1-9]\d{1,14}$/)
        .withMessage('Phone must be in E.164 format, e.g. +919876543210'),
    body('relationship').optional().isString().isLength({ max: 50 }),
    body('isPrimary').optional().isBoolean(),
    body('notifyOnAlert').optional().isBoolean(),
];

const updateContactRules = [
    body('name').optional().trim().isLength({ max: 100 }),
    body('phone')
        .optional()
        .matches(/^\+?[1-9]\d{1,14}$/)
        .withMessage('Phone must be in E.164 format'),
    body('relationship').optional().isString().isLength({ max: 50 }),
    body('isPrimary').optional().isBoolean(),
    body('notifyOnAlert').optional().isBoolean(),
];

router.use(protect);

router.route('/').get(getContacts).post(contactRules, validate, addContact);
router.route('/:id').put(updateContactRules, validate, updateContact).delete(deleteContact);

module.exports = router;
