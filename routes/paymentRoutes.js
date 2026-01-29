const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const wompiController = require('../controllers/wompiController');

// @desc    Generate Wompi Signature
// @route   POST /api/payments/signature
// @access  Private
router.post('/signature', wompiController.generateSignature);

// @desc    Wompi Webhook
// @route   POST /api/payments/webhook
// @access  Public
router.post('/webhook', wompiController.handleWebhook);

// @desc    Verify Wompi Transaction (Frontend Redirect)
// @route   GET /api/payments/verify/:id
// @access  Private (or Public if needed, but safer Private)
router.get('/verify/:id', wompiController.verifyTransaction);

module.exports = router;
