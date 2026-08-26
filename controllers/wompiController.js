const crypto = require('crypto');
const Order = require('../models/Order');
const { markOrderAsPaid } = require('../utils/orderFulfillment');

const wompiController = {};

/** Wompi decide el ambiente por el prefijo de la llave publica. */
const wompiApiUrl = () => {
    const publicKey = process.env.WOMPI_PUBLIC_KEY || '';
    return publicKey.startsWith('pub_test_')
        ? 'https://sandbox.wompi.co/v1/transactions'
        : 'https://production.wompi.co/v1/transactions';
};

/**
 * Firma de integridad que exige el widget de Wompi.
 * Firma = SHA256(referencia + montoEnCentavos + moneda + secretoDeIntegridad)
 */
wompiController.generateSignature = async (req, res) => {
    try {
        const { orderId, amount } = req.body;

        if (!orderId || !amount) {
            return res.status(400).json({ msg: 'Se requieren el id de la orden y el monto' });
        }

        const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
        const publicKey = process.env.WOMPI_PUBLIC_KEY;

        if (!integritySecret || !publicKey) {
            console.error('WOMPI_INTEGRITY_SECRET o WOMPI_PUBLIC_KEY sin configurar');
            return res.status(500).json({ msg: 'Error de configuracion del servidor' });
        }

        const secretToUse = integritySecret.replace(/['"]+/g, '').trim();
        const currency = 'COP';
        const amountInCents = Math.round(Number(amount) * 100);
        const reference = orderId.toString();

        const signature = crypto
            .createHash('sha256')
            .update(`${reference}${amountInCents}${currency}${secretToUse}`)
            .digest('hex');

        res.json({ signature, reference, amountInCents, currency, publicKey });
    } catch (error) {
        console.error('Error generando la firma de Wompi:', error);
        res.status(500).json({ msg: 'Error generando la firma', error: error.message });
    }
};

/**
 * Webhook de Wompi. Valida el checksum HMAC y confirma la orden.
 */
wompiController.handleWebhook = async (req, res) => {
    try {
        const { event, data, signature } = req.body;

        if (event !== 'transaction.updated') {
            return res.sendStatus(200);
        }

        const transaction = data.transaction;
        const eventsSecret = process.env.WOMPI_EVENTS_SECRET;

        if (!eventsSecret) {
            console.error('WOMPI_EVENTS_SECRET sin definir');
            return res.sendStatus(500);
        }

        const getNestedValue = (obj, path) =>
            path.split('.').reduce((acc, part) => acc && acc[part], obj);

        let concatenationString = '';
        (signature.properties || []).forEach((prop) => {
            concatenationString += getNestedValue(data, prop);
        });
        concatenationString += eventsSecret.trim();

        const expectedChecksum = crypto
            .createHash('sha256')
            .update(concatenationString)
            .digest('hex');

        if (signature.checksum !== expectedChecksum) {
            console.error('[WOMPI] Firma de webhook invalida');
            return res.sendStatus(400);
        }

        const orderId = transaction.reference;
        const status = transaction.status;
        console.log(`[WOMPI] Webhook: orden ${orderId} en estado ${status}`);

        const order = await Order.findById(orderId);
        if (!order) {
            console.error('[WOMPI] Orden no encontrada:', orderId);
            return res.sendStatus(200);
        }

        if (status === 'APPROVED') {
            // Mismo camino que usan Addi y Sistecredito: descuenta stock, manda
            // correos y reporta la venta al panel. Antes el webhook hacia solo
            // una parte y la venta no llegaba a contabilidad.
            await markOrderAsPaid(order, {
                method: 'WOMPI',
                transactionId: transaction.id,
                rawStatus: status,
                customerEmail: transaction.customer_email || transaction.customer_data?.email,
            });
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('[WOMPI] Error en el webhook:', error);
        res.sendStatus(500);
    }
};

/**
 * Confirma la orden a partir de una transaccion consultada a Wompi.
 * El estado viene de la API de Wompi, nunca del navegador.
 */
async function processTransactionData(transaction, res) {
    const orderId = transaction.reference;
    const status = transaction.status;

    if (!/^[0-9a-fA-F]{24}$/.test(String(orderId))) {
        return res.status(400).json({ msg: 'Referencia de transaccion invalida' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
        console.error('[WOMPI] Orden no encontrada localmente para la referencia:', orderId);
        return res.status(404).json({ msg: 'Orden no encontrada' });
    }

    if (status === 'APPROVED' && !order.isPaid) {
        await markOrderAsPaid(order, {
            method: 'WOMPI',
            transactionId: transaction.id,
            rawStatus: status,
            customerEmail: transaction.customer_data?.email || transaction.customer_email,
        });
    }

    res.json({ status, orderId, isPaid: order.isPaid });
}

/**
 * Verificar transaccion por id de Wompi (regreso del widget).
 * @route GET /api/payments/verify/:id
 */
wompiController.verifyTransaction = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ msg: 'Se requiere el id de la transaccion' });

        const response = await fetch(`${wompiApiUrl()}/${id}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${process.env.WOMPI_PUBLIC_KEY}` },
        });

        if (!response.ok) {
            throw new Error(`Transaccion no encontrada o error de API: ${response.status}`);
        }

        const data = await response.json();
        return await processTransactionData(data.data, res);
    } catch (error) {
        console.error('[WOMPI] Error verificando la transaccion:', error);
        res.status(500).json({ msg: 'Error verificando la transaccion' });
    }
};

/**
 * Respaldo: buscar la transaccion por referencia cuando el widget no devolvio
 * el transactionId.
 * @route GET /api/payments/verify-by-reference/:orderId
 */
wompiController.verifyTransactionByReference = async (req, res) => {
    const { orderId } = req.params;

    /** Ultimo recurso: responder con lo que ya sabe la base de datos. */
    const answerFromDatabase = async () => {
        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ msg: 'Orden no encontrada' });
        return res.json({
            status: order.isPaid ? 'APPROVED' : 'PENDING',
            orderId,
            isPaid: order.isPaid,
        });
    };

    try {
        if (!orderId) return res.status(400).json({ msg: 'Se requiere el id de la orden' });

        const response = await fetch(`${wompiApiUrl()}?reference=${orderId}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${process.env.WOMPI_PUBLIC_KEY}` },
        });

        if (!response.ok) return await answerFromDatabase();

        const data = await response.json();
        const transactions = data.data;

        if (!transactions || transactions.length === 0) return await answerFromDatabase();

        const latestTx = transactions.find((t) => t.status === 'APPROVED') || transactions[0];
        return await processTransactionData(latestTx, res);
    } catch (error) {
        console.error('[WOMPI] Error verificando por referencia:', error);
        try {
            return await answerFromDatabase();
        } catch (dbErr) {
            return res.status(500).json({ msg: 'Error verificando la transaccion por referencia' });
        }
    }
};

module.exports = wompiController;
