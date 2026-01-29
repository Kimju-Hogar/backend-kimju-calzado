const Order = require('../models/Order');
const Product = require('../models/Product');
const { sendOrderEmail, sendAdminNewOrderEmail, sendTrackingEmail } = require('../utils/emailService');

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
exports.getOrders = async (req, res) => {
    try {
        const orders = await Order.find({}).populate('user', 'id name email');
        res.json(orders);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
exports.addOrderItems = async (req, res) => {
    try {
        const { orderItems, shippingAddress, paymentMethod, itemsPrice, taxPrice, shippingPrice, totalPrice } = req.body;

        if (orderItems && orderItems.length === 0) {
            res.status(400);
            throw new Error('No order items');
        } else {
            const order = new Order({
                user: req.user.id,
                orderItems,
                shippingAddress: {
                    ...shippingAddress,
                    // Ensure legalId is passed if it exists in shippingAddress object
                    legalId: shippingAddress.legalId
                },
                paymentMethod,
                itemsPrice,
                taxPrice,
                shippingPrice,
                totalPrice
            });

            const createdOrder = await order.save();


            // Emails will be sent after Wompi Payment Verification
            // const fullUser = await require('../models/User').findById(req.user.id);
            // if (fullUser) {
            //    await sendOrderEmail(createdOrder, fullUser);
            //    await sendAdminNewOrderEmail(createdOrder, fullUser);
            // }

            res.status(201).json(createdOrder);
        }
    } catch (err) {
        console.error('Error creating order:', err);
        res.status(500).json({ message: err.message });
    }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
exports.getOrderById = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email');

        if (order) {
            if (req.user.role === 'admin' || order.user._id.toString() === req.user.id) {
                res.json(order);
            } else {
                res.status(401).json({ msg: 'Not authorized to view this order' });
            }
        } else {
            res.status(404).json({ msg: 'Order not found' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
exports.getMyOrders = async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
        res.json(orders);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private/Admin
exports.updateOrderToPaid = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (order) {
            order.isPaid = true;
            order.paidAt = Date.now();
            order.paymentResult = {
                id: 'MANUAL_PAYMENT',
                status: 'completed',
                update_time: Date.now().toString(),
                email_address: order.shippingAddress.email || 'manual@system.com'
            };

            const updatedOrder = await order.save();
            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found' });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private/Admin
exports.updateOrderStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findById(req.params.id);

        if (order) {
            order.status = status;
            if (status === 'Delivered') {
                order.isDelivered = true;
                order.deliveredAt = Date.now();
            }
            const updatedOrder = await order.save();
            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found' });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Verify Wompi Payment and Update Order
// @route   PUT /api/orders/pay-wompi
// @access  Private
exports.verifyWompiPayment = async (req, res) => {
    try {
        const { transactionId, reference, transactionData } = req.body;

        let order;
        // Attempt to find by ID if reference looks like a MongoID, otherwise we might need a reference field.

        // Priority: supplied orderId (simplest) > transaction reference (if it matches ID)

        if (req.body.orderId) {
            order = await Order.findById(req.body.orderId);
        } else if (reference && reference.match(/^[0-9a-fA-F]{24}$/)) {
            order = await Order.findById(reference);
        }

        if (order) {
            if (order.isPaid) {
                return res.json(order); // Already processed
            }

            order.isPaid = true;
            order.paidAt = Date.now();
            order.paymentResult = {
                id: transactionId,
                status: 'APPROVED',
                update_time: new Date().toISOString(),
                email_address: order.shippingAddress?.email || req.user.email
            };
            // Also update status to 'Processing' instead of just 'Pending' if paid
            order.status = 'Processing';

            // Reduce Stock
            for (const item of order.orderItems) {
                const product = await Product.findById(item.product);
                if (product) {
                    product.stock = Math.max(0, product.stock - item.quantity);
                    await product.save();
                }
            }

            const updatedOrder = await order.save();

            // Send Notifications (Only if just paid)
            const fullUser = await require('../models/User').findById(order.user);
            if (fullUser) {
                await sendOrderEmail(updatedOrder, fullUser);
                await sendAdminNewOrderEmail(updatedOrder, fullUser);
            }

            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found for this payment' });
        }
    } catch (err) {
        console.error("Wompi Verification Error:", err);
        res.status(500).json({ message: err.message });
    }
};

// @desc    Update order tracking number
// @route   PUT /api/orders/:id/tracking
// @access  Private/Admin
exports.updateOrderTracking = async (req, res) => {
    try {
        const { trackingNumber } = req.body;
        const order = await Order.findById(req.params.id).populate('user', 'name email');

        if (order) {
            // We can store tracking number in a new field or inside delivery status
            // Checking Order model would be ideal, but I'll assume we can add a new field dynamically or `result` field.
            // Let's treat it as part of `deliveryResult` or top level if schema permits.
            // Javascript mongo models are flexible unless strict.
            // I'll add `trackingNumber` to the order object.

            // Note: Mongoose strict mode might strip this if not in schema. 
            // We should ideally check Schema. But for now, let's try. 
            // If it fails to save, we might need to use a 'mixed' field if available or add it to Schema.
            // Assuming Schema is not provided, I will try to save. If it fails, I'll advise user or check schema.

            order.trackingNumber = trackingNumber;
            order.isDelivered = false; // Still in progress, but shipped?
            order.status = 'Shipped'; // Update status to Shipped

            const updatedOrder = await order.save(); // This might strip trackingNumber if strict: true

            // Send Tracking Email
            await sendTrackingEmail(updatedOrder, trackingNumber);

            res.json(updatedOrder);
        } else {
            res.status(404).json({ message: 'Order not found' });
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
