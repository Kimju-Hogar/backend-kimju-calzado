const Order = require('../models/Order');
const { sendTrackingEmail } = require('../utils/emailService');
const { markOrderAsPaid } = require('../utils/orderFulfillment');
const { normalizePaymentMethod, PAYMENT_METHODS, applySurcharge } = require('../config/payments');
const { storeName } = require('../services/panelSync');

// @desc    Listar todas las ordenes
// @route   GET /api/orders
// @access  Privado/Admin
exports.getOrders = async (req, res) => {
    try {
        const orders = await Order.find({}).populate('user', 'id name email');
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Crear una orden
// @route   POST /api/orders
// @access  Privado
exports.addOrderItems = async (req, res) => {
    try {
        const {
            orderItems,
            shippingAddress,
            paymentMethod,
            itemsPrice,
            taxPrice,
            shippingPrice,
            totalPrice,
        } = req.body;

        if (!orderItems || orderItems.length === 0) {
            return res.status(400).json({ message: 'La orden no tiene productos' });
        }

        // El medio de pago se valida contra el catalogo. Antes el checkout
        // mandaba siempre 'WOMPI' aunque el cliente eligiera pagar a cuotas, y
        // esa etiqueta equivocada era la que terminaba en los reportes.
        const method = normalizePaymentMethod(paymentMethod);
        if (!method) {
            return res.status(400).json({
                message: `Medio de pago no valido. Opciones: ${Object.keys(PAYMENT_METHODS).join(', ')}`,
            });
        }

        // El recargo lo calcula el servidor, nunca el navegador: si viniera del
        // cliente bastaria con editar la peticion para no pagarlo.
        const baseAmount =
            Number(itemsPrice || 0) + Number(shippingPrice || 0) + Number(taxPrice || 0);
        const surcharge = applySurcharge(baseAmount, method);

        if (surcharge.amount > 0) {
            console.log(
                `[Orden] Recargo ${surcharge.percentage}% por ${method}: ` +
                `${surcharge.base} -> ${surcharge.total}`
            );
        }

        const order = new Order({
            user: req.user.id,
            // Queda grabado de que tienda salio, para que el reporte al Panel sea
            // correcto aunque el webhook lo atienda el backend de la otra tienda.
            store: storeName(),
            orderItems,
            shippingAddress: {
                ...shippingAddress,
                legalId: shippingAddress?.legalId,
            },
            paymentMethod: method,
            itemsPrice,
            taxPrice,
            shippingPrice,
            // El total lo fija el servidor a partir de la base y el recargo.
            totalPrice: surcharge.total,
            surcharge: {
                percentage: surcharge.percentage,
                amount: surcharge.amount,
                baseAmount: surcharge.base,
            },
        });

        const createdOrder = await order.save();

        // Los correos salen cuando el pago queda confirmado, no antes.
        res.status(201).json(createdOrder);
    } catch (err) {
        console.error('Error creando la orden:', err);
        res.status(500).json({ message: err.message });
    }
};

// @desc    Obtener una orden por id
// @route   GET /api/orders/:id
// @access  Privado
exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ msg: 'Orden no encontrada' });
        }

        if (req.user.role === 'admin' || order.user._id.toString() === req.user.id) {
            return res.json(order);
        }

        res.status(401).json({ msg: 'No autorizado para ver esta orden' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Ordenes del usuario autenticado
// @route   GET /api/orders/myorders
// @access  Privado
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Marcar una orden como pagada manualmente
// @route   PUT /api/orders/:id/pay
// @access  Privado/Admin
exports.updateOrderToPaid = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Solo un administrador puede registrar un pago manual' });
        }

        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Orden no encontrada' });
        }

        const updatedOrder = await markOrderAsPaid(order, {
            method: 'MANUAL',
            transactionId: 'MANUAL_PAYMENT',
            rawStatus: 'MANUAL',
            customerEmail: order.shippingAddress?.email,
        });

        res.json(updatedOrder);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Cambiar el estado de una orden
// @route   PUT /api/orders/:id/status
// @access  Privado/Admin
exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Orden no encontrada' });
        }

        order.status = status;
        if (status === 'Delivered') {
            order.isDelivered = true;
            order.deliveredAt = Date.now();
        }

        const updatedOrder = await order.save();
        res.json(updatedOrder);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Confirmar un pago de Wompi desde el frontend
// @route   PUT /api/orders/pay-wompi
// @access  Privado
//
// Descontar stock, enviar correos y reportar la venta al panel ya no se hace
// aqui a mano: todo eso vive en markOrderAsPaid, el mismo camino que usan Addi
// y Sistecredito. Asi las tres formas de pago se comportan igual.
exports.verifyWompiPayment = async (req, res) => {
    try {
        const { transactionId, reference, orderId } = req.body;

        let order = null;
        if (orderId) {
            order = await Order.findById(orderId);
        } else if (reference && /^[0-9a-fA-F]{24}$/.test(reference)) {
            order = await Order.findById(reference);
        }

        if (!order) {
            return res.status(404).json({ message: 'No se encontro la orden de este pago' });
        }

        if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'No autorizado sobre esta orden' });
        }

        if (order.isPaid) {
            return res.json(order);
        }

        const updatedOrder = await markOrderAsPaid(order, {
            method: 'WOMPI',
            transactionId,
            rawStatus: 'APPROVED',
            customerEmail: order.shippingAddress?.email || req.user.email,
        });

        res.json(updatedOrder);
    } catch (err) {
        console.error('Error confirmando el pago de Wompi:', err);
        res.status(500).json({ message: err.message });
    }
};

// @desc    Registrar el numero de guia
// @route   PUT /api/orders/:id/tracking
// @access  Privado/Admin
exports.updateOrderTracking = async (req, res) => {
    try {
        const { trackingNumber } = req.body;
        const order = await Order.findById(req.params.id).populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ message: 'Orden no encontrada' });
        }

        order.trackingNumber = trackingNumber;
        order.isDelivered = false;
        order.status = 'Shipped';

        const updatedOrder = await order.save();

        try {
            await sendTrackingEmail(updatedOrder, trackingNumber);
        } catch (mailErr) {
            console.error('Error enviando el correo de seguimiento:', mailErr.message);
        }

        res.json(updatedOrder);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
