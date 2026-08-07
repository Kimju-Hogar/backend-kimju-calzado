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

// @desc    Verify Wompi Transaction (Frontend Redirect by TransactionId)
// @route   GET /api/payments/verify/:id
// @access  Private
router.get('/verify/:id', wompiController.verifyTransaction);

// @desc    Verify Wompi Transaction by Reference/OrderId (Fallback - no transactionId needed)
// @route   GET /api/payments/verify-by-reference/:orderId
// @access  Private
router.get('/verify-by-reference/:orderId', wompiController.verifyTransactionByReference);

module.exports = router;
