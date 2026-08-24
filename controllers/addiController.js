const axios = require('axios');
const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { sendOrderEmail } = require('../utils/emailService');

const addiController = {};

// 1. Create Application
addiController.createApplication = async (req, res) => {
    try {
        const { orderId } = req.body;
        
        if (!orderId) {
            return res.status(400).json({ msg: 'Order ID is required' });
        }

        const order = await Order.findById(orderId).populate('user', 'name email');
        if (!order) {
            return res.status(404).json({ msg: 'Order not found' });
        }

        const clientId = process.env.ADDI_CLIENT_ID;
        const clientSecret = process.env.ADDI_CLIENT_SECRET;
        const addiUrl = process.env.ADDI_API_URL || 'https://api.addi.com';
        
        if (!clientId || !clientSecret) {
            console.error('ADDI credentials not set in .env');
            return res.status(500).json({ msg: 'Server configuration error' });
        }

        // Addi requires amount in exact units (not cents, though double check Addi API, usually they use integers)
        const amount = Math.round(Number(order.totalPrice));

        // Note: For a real Addi integration, you'd generate a token first if needed, 
        // or use basic auth depending on their specific API version. 
        // Assuming Standard Addi v1 Create Application API pattern:
        
        const payload = {
            orderId: order._id.toString(),
            amount: amount,
            currency: 'COP',
            items: order.orderItems.map(item => ({
                sku: item.product.toString(),
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.price
            })),
            client: {
                firstName: order.shippingAddress.fullName.split(' ')[0],
                lastName: order.shippingAddress.fullName.split(' ').slice(1).join(' ') || 'Cliente',
                cellphone: order.shippingAddress.phone,
                email: order.shippingAddress.email || order.user.email
            },
            redirectUrl: `${process.env.FRONTEND_URL}/order/${order._id}/addi-result`,
            webhookUrl: `${process.env.API_URL}/payments/addi/webhook`
        };

        // Simulating Addi Create Application request (Replace with actual axios call)
        // const response = await axios.post(`${addiUrl}/v1/applications`, payload, {
        //     headers: { 'Authorization': `Bearer ${clientSecret}` }
        // });
        // const applicationUrl = response.data.applicationUrl;
        
        // Mocking response for now since we don't have real Addi API structure yet
        const mockApplicationId = 'addi_' + crypto.randomBytes(8).toString('hex');
        const applicationUrl = `${process.env.FRONTEND_URL}/order/${order._id}/addi-result?applicationId=${mockApplicationId}&status=APPROVED`;
        
        res.json({
            applicationId: mockApplicationId,
            applicationUrl: applicationUrl
        });

    } catch (error) {
        console.error('Addi Create Error:', error);
        res.status(500).json({ msg: 'Server error creating Addi application' });
    }
};

// 2. Verify Application Status
addiController.verifyApplication = async (req, res) => {
    try {
        const { applicationId, orderId } = req.body;
        
        // Here you would call Addi API to verify status
        // const response = await axios.get(`${process.env.ADDI_API_URL}/v1/applications/${applicationId}`...
        
        // Mock verification
        let status = req.query.status || req.body.status || 'APPROVED';
        
        const order = await Order.findById(orderId);
        
        if (order && !order.isPaid && status === 'APPROVED') {
            order.isPaid = true;
            order.paidAt = Date.now();
            order.paymentResult = {
                id: applicationId,
                status: 'APPROVED',
                update_time: new Date().toISOString(),
                email_address: order.shippingAddress?.email
            };
            order.status = 'Processing';
            order.paymentMethod = 'ADDI';

            // Reduce Stock
            for (const item of order.orderItems) {
                const product = await Product.findById(item.product);
                if (product) {
                    product.stock = Math.max(0, product.stock - item.quantity);
                    await product.save();
                }
            }

            await order.save();
            res.json({ status: 'APPROVED', order });
        } else if (order && order.isPaid) {
             res.json({ status: 'APPROVED', order });
        } else {
            res.json({ status: status, order });
        }
        
    } catch (error) {
        console.error('Addi Verify Error:', error);
        res.status(500).json({ msg: 'Server error verifying Addi application' });
    }
};

module.exports = addiController;
