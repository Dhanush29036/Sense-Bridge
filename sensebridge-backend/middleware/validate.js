const { validationResult } = require('express-validator');

/**
 * Middleware: run after express-validator chains.
 * Returns 422 with all validation errors if any, else calls next().
 */
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(422).json({
            success: false,
            message: 'Validation failed.',
            errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
        });
    }
    next();
};

module.exports = validate;
