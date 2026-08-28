const mongoose = require('mongoose');
const { PAYMENT_METHOD_CODES } = require('../config/payments');

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    orderItems: [
        {
            product: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Product',
                required: true,
            },
            name: { type: String, required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true },
            image: { type: String },
            selectedVariation: { type: String }, // Talla o color elegido
        }
    ],
    shippingAddress: {
        fullName: { type: String },
        email: { type: String },
        legalId: { type: String },
        phone: { type: String },
        address: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String },
        postalCode: { type: String },
        country: { type: String, required: true },
        additionalInfo: { type: String },
    },
    // Codigo canonico del medio de pago. La lista vive en config/payments.js
    // y es la misma que usa el Panel de Contabilidad para agrupar reportes.
    // Tienda que origino la orden ("Kimju Hogar" / "Kimju Calzado").
    //
    // Las dos tiendas comparten la misma base de datos y la misma cuenta de
    // Addi, que solo admite una URL de notificacion. Es decir: el webhook de una
    // orden de calzado puede llegarle al backend de hogar. Sin este campo, la
    // venta se reportaria al Panel con el nombre del backend que la proceso, no
    // con el de la tienda donde se compro.
    store: {
        type: String,
    },
    paymentMethod: {
        type: String,
        required: true,
        enum: PAYMENT_METHOD_CODES,
        default: 'WOMPI',
    },
    paymentResult: { // Respuesta de la pasarela
        id: { type: String },
        status: { type: String },
        update_time: { type: String },
        email_address: { type: String },
    },
    // Solicitud de credito a cuotas (Addi / Sistecredito).
    // applicationId es la unica referencia valida: se lee de aqui, nunca del cliente.
    creditApplication: {
        provider: { type: String, enum: ['ADDI', 'SISTECREDITO'] },
        applicationId: { type: String, index: true },
        status: {
            type: String,
            enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
            default: 'PENDING',
        },
        rawStatus: { type: String },   // Estado tal cual lo devuelve el financiador
        redirectUrl: { type: String }, // URL real del financiador
        simulated: { type: Boolean, default: false },
        createdAt: { type: Date },
        updatedAt: { type: Date },
    },
    // Evita enviar la misma venta dos veces a contabilidad.
    syncedToPanel: {
        type: Boolean,
        default: false,
    },
    itemsPrice: {
        type: Number,
        default: 0.0,
    },
    taxPrice: {
        type: Number,
        required: true,
        default: 0.0,
    },
    shippingPrice: {
        type: Number,
        required: true,
        default: 0.0,
    },
    totalPrice: {
        type: Number,
        required: true,
        default: 0.0,
    },
    isPaid: {
        type: Boolean,
        required: true,
        default: false,
    },
    paidAt: {
        type: Date,
    },
    isDelivered: {
        type: Boolean,
        required: true,
        default: false,
    },
    deliveredAt: {
        type: Date,
    },
    status: {
        type: String,
        default: 'Pending', // Pending, Processing, Shipped, Delivered, Cancelled
    },
    trackingNumber: {
        type: String
    }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
