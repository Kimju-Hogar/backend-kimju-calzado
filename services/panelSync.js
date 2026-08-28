/**
 * Envío de ventas al Panel de Contabilidad.
 *
 * Antes esta lógica estaba escrita a mano dentro de orderController y mandaba
 * siempre `paymentMethod: 'Wompi'`, sin importar cómo hubiera pagado el cliente.
 * Ahora hay un solo punto de salida y el medio de pago viaja tal como quedó
 * registrado en la orden (Wompi / Addi / Sistecrédito), que es lo que después
 * el panel usa para agrupar los reportes.
 */

const axios = require('axios');
const Product = require('../models/Product');
const { getReportLabel } = require('../config/payments');

const TIMEOUT_MS = Number(process.env.PANEL_SYNC_TIMEOUT_MS || 15000);

/** Nombre del canal con el que la venta queda registrada en el panel. */
const storeName = () => process.env.STORE_NAME || 'Tienda Online';

/**
 * Reporta una orden pagada al panel. Nunca lanza: si el panel está caído la
 * venta de la tienda no se puede perder por eso. Devuelve true si se sincronizó.
 */
const syncSaleToPanel = async (order, { customerName, customerEmail } = {}) => {
    const panelUrl = process.env.PANEL_API_URL;
    const syncSecret = process.env.SYNC_SECRET;

    if (!panelUrl || !syncSecret) {
        console.warn('[PanelSync] PANEL_API_URL o SYNC_SECRET sin configurar. Venta no sincronizada.');
        return false;
    }

    // Las órdenes simuladas (modo de pruebas) jamás llegan a contabilidad.
    if (order.creditApplication?.simulated) {
        console.log('[PanelSync] Orden simulada, se omite el envío al panel.');
        return false;
    }

    if (order.syncedToPanel) {
        console.log(`[PanelSync] La orden ${order._id} ya estaba sincronizada.`);
        return true;
    }

    try {
        const products = [];
        for (const item of order.orderItems) {
            const productDoc = await Product.findById(item.product);
            products.push({
                sku: productDoc?.sku || productDoc?.name || item.name,
                quantity: item.quantity,
                price: item.price,
            });
        }

        await axios.post(
            `${panelUrl.replace(/\/+$/, '')}/api/sync/sales`,
            {
                orderId: order._id.toString(),
                products,
                totalAmount: order.totalPrice,
                // Aquí está la corrección clave del reporte de ventas.
                paymentMethod: getReportLabel(order.paymentMethod),
                paymentReference: order.paymentResult?.id || '',
                customer: {
                    name: customerName || order.shippingAddress?.fullName || 'Cliente Online',
                    email: customerEmail || order.shippingAddress?.email || '',
                },
                // El de la orden manda: si el webhook lo atendio el backend de
                // la otra tienda, storeName() seria el equivocado.
                origin: order.store || storeName(),
            },
            {
                timeout: TIMEOUT_MS,
                headers: { 'x-sync-secret': syncSecret },
            }
        );

        order.syncedToPanel = true;
        await order.save();

        console.log(
            `[PanelSync] Venta ${order._id} enviada al panel como "${getReportLabel(order.paymentMethod)}" (${order.store || storeName()}).`
        );
        return true;
    } catch (error) {
        console.error('[PanelSync] No se pudo sincronizar la venta:', error.message);
        return false;
    }
};

module.exports = { syncSaleToPanel, storeName };
