const express = require('express');
const router = express.Router();
const {
    addOrderItems,
    getOrderById,
    getMyOrders,
    getOrders,
    updateOrderToPaid,
    updateOrderStatus,
    verifyWompiPayment,
    updateOrderTracking,
} = require('../controllers/orderController');
const auth = require('../middleware/authMiddleware');
const admin = require('../middleware/adminMiddleware');
const { getInvoice } = require('../controllers/invoiceController');

// Las rutas literales van antes que las de parametro para que /myorders y
// /pay-wompi no queden atrapadas por /:id.
router.post('/', auth, addOrderItems);
router.get('/myorders', auth, getMyOrders);
router.put('/pay-wompi', auth, verifyWompiPayment);

// Listar TODAS las ordenes es informacion de administracion: antes bastaba con
// estar logueado para verlas todas.
router.get('/', auth, admin, getOrders);

router.get('/:id', auth, getOrderById);
router.put('/:id/pay', auth, admin, updateOrderToPaid);
router.put('/:id/status', auth, admin, updateOrderStatus);
router.put('/:id/tracking', auth, admin, updateOrderTracking);
router.get('/:id/invoice', auth, getInvoice);

module.exports = router;
