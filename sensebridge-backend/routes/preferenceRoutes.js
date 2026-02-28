const express = require('express');
const { body } = require('express-validator');
const { getPreferences, updatePreferences } = require('../controllers/preferenceController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const updateRules = [
    body('language').optional().isString().isLength({ max: 10 }),
    body('voiceSpeed').optional().isFloat({ min: 0.5, max: 3.0 }),
    body('alertType').optional().isIn(['sound', 'vibration', 'visual', 'all']),
    body('features').optional().isObject(),
    body('accessibility').optional().isObject(),
];

router.use(protect); // All preference routes require auth

router.get('/', getPreferences);
router.put('/', ...updateRules, validate, updatePreferences);

module.exports = router;
