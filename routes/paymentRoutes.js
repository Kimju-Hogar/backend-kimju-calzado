const express = require('express');
const router = express.Router();

const auth = require('../middleware/authMiddleware');
const wompiController = require('../controllers/wompiController');
const installmentController = require('../controllers/installmentController');

// ── Medios de pago disponibles ───────────────────────────────────────────────

// @desc    Medios de pago habilitados y sus límites
// @route   GET /api/payments/methods
// @access  Público
router.get('/methods', installmentController.getAvailableMethods);

// ── Wompi ────────────────────────────────────────────────────────────────────

// @desc    Firma de integridad para el widget
// @route   POST /api/payments/signature
router.post('/signature', wompiController.generateSignature);

// @desc    Webhook de Wompi
// @route   POST /api/payments/webhook
// @access  Público
router.post('/webhook', wompiController.handleWebhook);

// @desc    Verificar transacción de Wompi (regreso del widget)
// @route   GET /api/payments/verify/:id
router.get('/verify/:id', wompiController.verifyTransaction);
// @desc    Verificar transacción de Wompi por referencia (respaldo)
// @route   GET /api/payments/verify-by-reference/:orderId
router.get('/verify-by-reference/:orderId', wompiController.verifyTransactionByReference);

// ── Pagos a cuotas: Addi y Sistecrédito ──────────────────────────────────────

// @desc    Crear la solicitud de crédito en el financiador
// @route   POST /api/payments/credit/:provider/create
// @access  Privado
router.post('/credit/:provider/create', auth, installmentController.createApplication);

// @desc    Consultar el estado real de la solicitud
// @route   POST /api/payments/credit/verify
// @access  Privado
router.post('/credit/verify', auth, installmentController.verifyApplication);

// @desc    Decisión manual del simulador (solo fuera de producción)
// @route   POST /api/payments/credit/simulator/decide
// @access  Privado
router.post('/credit/simulator/decide', auth, installmentController.simulatorDecide);

// @desc    Notificación del financiador
// @route   POST /api/payments/credit/:provider/webhook
// @access  Público
router.post('/credit/:provider/webhook', installmentController.handleWebhook);

// ── Compatibilidad con las rutas antiguas de Addi ────────────────────────────
// Las conserva un frontend ya desplegado. Ojo: /addi/verify ya NO acepta un
// `status` enviado por el cliente; el estado se consulta contra Addi.
router.post('/addi/create', auth, (req, res) => {
    req.params.provider = 'ADDI';
    return installmentController.createApplication(req, res);
});
router.post('/addi/verify', auth, installmentController.verifyApplication);
router.post('/addi/webhook', (req, res) => {
    req.params.provider = 'ADDI';
    return installmentController.handleWebhook(req, res);
});

module.exports = router;
