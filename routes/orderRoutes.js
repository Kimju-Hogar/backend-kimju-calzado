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

    updateOrderTracking
} = require('../controllers/orderController');
const { getInvoice } = require('../controllers/invoiceController');
const auth = require('../middleware/authMiddleware');

router.post('/', auth, addOrderItems);
router.get('/myorders', auth, getMyOrders);
router.get('/', auth, getOrders);
router.get('/:id', auth, getOrderById);
router.put('/:id/pay', auth, updateOrderToPaid);
router.put('/pay-wompi', auth, verifyWompiPayment);
router.put('/:id/status', auth, updateOrderStatus);
router.put('/:id/tracking', auth, updateOrderTracking);
router.get('/:id/invoice', auth, getInvoice);

module.exports = router;
