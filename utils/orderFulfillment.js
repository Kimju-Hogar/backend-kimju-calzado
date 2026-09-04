/**
 * Un único camino para dar una orden por pagada.
 *
 * Antes cada pasarela repetía su propia versión de "marcar pagada + descontar
 * stock + enviar correo + avisar al panel", con diferencias entre ellas (el
 * webhook de Wompi, por ejemplo, nunca reportaba la venta al panel). Ahora
 * Wompi, Addi y Sistecrédito pasan todos por aquí, así que el comportamiento y
 * los reportes son idénticos sin importar cómo pagó el cliente.
 */

const Product = require('../models/Product');
const User = require('../models/User');
const { sendOrderEmail, sendAdminNewOrderEmail } = require('./emailService');
const { syncSaleToPanel } = require('../services/panelSync');
const { notifyNewOrder } = require('../services/whatsappNotifier');
const { normalizePaymentMethod } = require('../config/payments');

/** Descuenta stock global y el de la variación (talla o color) si aplica. */
const decreaseStock = async (orderItems) => {
    for (const item of orderItems) {
        try {
            const product = await Product.findById(item.product);
            if (!product) continue;

            product.stock = Math.max(0, product.stock - item.quantity);

            if (item.selectedVariation) {
                const colorIndex = (product.colors || []).findIndex(
                    (c) => c.color === item.selectedVariation
                );
                if (colorIndex > -1) {
                    product.colors[colorIndex].stock = Math.max(
                        0,
                        product.colors[colorIndex].stock - item.quantity
                    );
                }

                const sizeIndex = (product.sizes || []).findIndex(
                    (s) => s.size === item.selectedVariation
                );
                if (sizeIndex > -1) {
                    product.sizes[sizeIndex].stock = Math.max(
                        0,
                        product.sizes[sizeIndex].stock - item.quantity
                    );
                }
            }

            await product.save();
        } catch (error) {
            console.error(`[Fulfillment] Error descontando stock de ${item.product}:`, error.message);
        }
    }
};

/**
 * Marca la orden como pagada y ejecuta todo lo que va después.
 * Es idempotente: si la orden ya estaba pagada no vuelve a descontar stock ni a
 * reenviar correos, solo devuelve la orden.
 *
 * @param {object} order            Documento de la orden (no un objeto plano)
 * @param {object} params
 * @param {string} params.method    Código canónico: WOMPI | ADDI | SISTECREDITO | MANUAL
 * @param {string} params.transactionId
 * @param {string} [params.rawStatus]
 * @param {string} [params.customerEmail]
 */
const markOrderAsPaid = async (order, { method, transactionId, rawStatus, customerEmail } = {}) => {
    if (!order) throw new Error('Orden no encontrada');

    if (order.isPaid) {
        console.log(`[Fulfillment] La orden ${order._id} ya estaba pagada, no se reprocesa.`);
        return order;
    }

    const normalizedMethod = normalizePaymentMethod(method) || order.paymentMethod || 'WOMPI';

    order.isPaid = true;
    order.paidAt = Date.now();
    order.status = 'Processing';
    order.paymentMethod = normalizedMethod;
    order.paymentResult = {
        id: transactionId,
        status: rawStatus || 'APPROVED',
        update_time: new Date().toISOString(),
        email_address: customerEmail || order.shippingAddress?.email || '',
    };

    await order.save();

    await decreaseStock(order.orderItems);

    // Correos: importantes, pero nunca deben tumbar la confirmación del pago.
    let user = null;
    try {
        user = await User.findById(order.user);
        const recipient = user
            ? { email: user.email, name: user.name }
            : { email: customerEmail || order.shippingAddress?.email, name: order.shippingAddress?.fullName || 'Cliente' };

        if (recipient.email) {
            await sendOrderEmail(order, recipient);
            await sendAdminNewOrderEmail(order, recipient);
        } else {
            console.warn(`[Fulfillment] Sin destinatario de correo para la orden ${order._id}`);
        }
    } catch (error) {
        console.error('[Fulfillment] Error enviando correos (no crítico):', error.message);
    }

    await syncSaleToPanel(order, {
        customerName: user?.name,
        customerEmail: user?.email || customerEmail,
    });

    // Aviso por WhatsApp. Va al final y no se espera su resultado para nada
    // critico: si el servicio esta caido, la venta ya quedo confirmada igual.
    await notifyNewOrder(order, { store: order.store });

    console.log(`[Fulfillment] Orden ${order._id} completada con ${normalizedMethod}.`);
    return order;
};

module.exports = { markOrderAsPaid, decreaseStock };
