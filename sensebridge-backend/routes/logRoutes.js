const express = require('express');
const { body, query } = require('express-validator');
const { getLogs, createLog, clearLogs } = require('../controllers/logController');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const createLogRules = [
    body('eventType')
        .isIn(['object_detection', 'gesture', 'speech_to_text', 'text_to_speech', 'navigation_alert', 'system'])
        .withMessage('Invalid eventType'),
    body('message').notEmpty().withMessage('Log message is required').isLength({ max: 500 }),
    body('confidence').optional().isFloat({ min: 0, max: 1 }),
    body('severity').optional().isIn(['info', 'warning', 'critical']),
    body('metadata').optional().isObject(),
];

const queryRules = [
    query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('eventType').optional().isString(),
    query('severity').optional().isIn(['info', 'warning', 'critical']),
];

router.use(protect);

router.route('/').get(queryRules, validate, getLogs).post(createLogRules, validate, createLog).delete(clearLogs);

module.exports = router;
