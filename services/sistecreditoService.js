/**
 * Integración con Sistecrédito (crédito a cuotas).
 *
 * Expone exactamente la misma interfaz que addiService, de modo que el
 * controlador de cuotas no necesita saber con cuál de los dos está hablando:
 *
 *   isConfigured() / publicConfig() / createApplication() / getApplicationStatus()
 *
 * Sistecrédito entrega a cada comercio su propio contrato (rutas y nombres de
 * campo cambian según el paquete contratado), así que TODO lo específico del
 * contrato vive en el bloque ENDPOINTS y en las variables de entorno de abajo.
 * Ajustar esos valores es lo único necesario para conectar contra la cuenta
 * real; el resto del sistema no cambia.
 */

const axios = require('axios');

const TIMEOUT_MS = Number(process.env.SISTECREDITO_TIMEOUT_MS || 20000);

// --- Contrato ajustable ------------------------------------------------------
// Rutas relativas a SISTECREDITO_API_URL. Se sobreescriben por .env si el
// contrato del comercio usa otras.
const ENDPOINTS = {
    token: process.env.SISTECREDITO_TOKEN_PATH || '/api/v1/auth/token',
    create: process.env.SISTECREDITO_CREATE_PATH || '/api/v1/payments',
    // {id} se reemplaza por el id de la transacción.
    status: process.env.SISTECREDITO_STATUS_PATH || '/api/v1/payments/{id}',
};
// -----------------------------------------------------------------------------

let tokenCache = { value: null, expiresAt: 0 };

const config = () => ({
    enabled: String(process.env.SISTECREDITO_ENABLED || '').toLowerCase() === 'true',
    apiUrl: (process.env.SISTECREDITO_API_URL || '').replace(/\/+$/, ''),
    clientId: (process.env.SISTECREDITO_CLIENT_ID || '').trim(),
    clientSecret: (process.env.SISTECREDITO_CLIENT_SECRET || '').trim(),
    // Código de comercio / punto de venta que asigna Sistecrédito.
    merchantId: (process.env.SISTECREDITO_MERCHANT_ID || '').trim(),
    apiKey: (process.env.SISTECREDITO_API_KEY || '').trim(),
    minAmount: Number(process.env.SISTECREDITO_MIN_AMOUNT || 100000),
    maxAmount: Number(process.env.SISTECREDITO_MAX_AMOUNT || 8000000),
});

const isConfigured = () => {
    const cfg = config();
    return Boolean(
        cfg.enabled && cfg.apiUrl && cfg.merchantId && (cfg.apiKey || (cfg.clientId && cfg.clientSecret))
    );
};

const publicConfig = () => {
    const cfg = config();
    return {
        code: 'SISTECREDITO',
        available: isConfigured(),
        minAmount: cfg.minAmount,
        maxAmount: cfg.maxAmount,
    };
};

/** Estados de Sistecrédito traducidos a nuestro vocabulario interno. */
const normalizeStatus = (rawStatus) => {
    const status = String(rawStatus || '').trim().toUpperCase();
    if (['APPROVED', 'APROBADA', 'APROBADO', 'PAID', 'PAGADA', 'SUCCESS', 'EXITOSA', 'CONFIRMED'].includes(status)) {
        return 'APPROVED';
    }
    if (['REJECTED', 'RECHAZADA', 'RECHAZADO', 'DECLINED', 'DENIED', 'FAILED', 'FALLIDA'].includes(status)) {
        return 'REJECTED';
    }
    if (['CANCELLED', 'CANCELED', 'CANCELADA', 'ANULADA', 'ABANDONED'].includes(status)) {
        return 'CANCELLED';
    }
    if (['EXPIRED', 'EXPIRADA', 'VENCIDA', 'TIMEOUT'].includes(status)) {
        return 'EXPIRED';
    }
    return 'PENDING';
};

const getAccessToken = async () => {
    const cfg = config();

    // Si el comercio usa API key estática, no hay ciclo de token.
    if (cfg.apiKey) return null;

    const now = Date.now();
    if (tokenCache.value && tokenCache.expiresAt > now + 30000) {
        return tokenCache.value;
    }

    const { data } = await axios.post(
        `${cfg.apiUrl}${ENDPOINTS.token}`,
        {
            grant_type: 'client_credentials',
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
        },
        { timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
    );

    const accessToken = data.access_token || data.accessToken || data.token;
    if (!accessToken) {
        throw new Error('Sistecrédito no devolvió un token de acceso');
    }

    const expiresInSeconds = Number(data.expires_in || data.expiresIn || 3600);
    tokenCache = { value: accessToken, expiresAt: now + expiresInSeconds * 1000 };
    return accessToken;
};

const authorizedHeaders = async () => {
    const cfg = config();
    const token = await getAccessToken();

    return {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cfg.apiKey ? { 'x-api-key': cfg.apiKey } : {}),
    };
};

const createApplication = async ({ order, customer, redirectUrl, webhookUrl, items }) => {
    const cfg = config();

    const payload = {
        merchantId: cfg.merchantId,
        // Referencia con la que Sistecrédito nos devuelve la transacción.
        reference: order._id.toString(),
        orderId: order._id.toString(),
        amount: Math.round(Number(order.totalPrice)),
        shippingAmount: Math.round(Number(order.shippingPrice || 0)),
        taxAmount: Math.round(Number(order.taxPrice || 0)),
        currency: 'COP',
        description: `Compra ${order._id.toString().slice(-8).toUpperCase()}`,
        items: items.map((item) => ({
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: Math.round(Number(item.price)),
        })),
        customer: {
            documentType: customer.idType || 'CC',
            documentNumber: customer.idNumber,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            phone: customer.phone,
            address: order.shippingAddress?.address || '',
            city: order.shippingAddress?.city || '',
            state: order.shippingAddress?.state || '',
        },
        returnUrl: redirectUrl,
        confirmationUrl: webhookUrl,
    };

    const { data } = await axios.post(`${cfg.apiUrl}${ENDPOINTS.create}`, payload, {
        timeout: TIMEOUT_MS,
        headers: await authorizedHeaders(),
    });

    const applicationId =
        data.transactionId || data.paymentId || data.id || data.reference || data.idTransaccion;
    const applicationUrl =
        data.redirectUrl || data.checkoutUrl || data.url || data.paymentUrl || data.urlPago;

    if (!applicationId || !applicationUrl) {
        throw new Error(
            `Respuesta inesperada de Sistecrédito al crear la transacción: ${JSON.stringify(data).slice(0, 500)}`
        );
    }

    return { applicationId: String(applicationId), applicationUrl, raw: data };
};

const getApplicationStatus = async (applicationId) => {
    const cfg = config();
    const path = ENDPOINTS.status.replace('{id}', encodeURIComponent(applicationId));

    const { data } = await axios.get(`${cfg.apiUrl}${path}`, {
        timeout: TIMEOUT_MS,
        headers: await authorizedHeaders(),
    });

    const rawStatus = data.status || data.estado || data.transactionStatus || data.state;

    return {
        status: normalizeStatus(rawStatus),
        rawStatus: String(rawStatus || 'UNKNOWN'),
        transactionId: data.transactionId || data.id || applicationId,
        raw: data,
    };
};

const extractApplicationIdFromWebhook = (body = {}) =>
    body.transactionId ||
    body.paymentId ||
    body.idTransaccion ||
    body.id ||
    body?.data?.transactionId ||
    null;

const extractOrderIdFromWebhook = (body = {}) =>
    body.orderId || body.reference || body.referencia || body?.data?.reference || null;

module.exports = {
    code: 'SISTECREDITO',
    isConfigured,
    publicConfig,
    config,
    normalizeStatus,
    createApplication,
    getApplicationStatus,
    extractApplicationIdFromWebhook,
    extractOrderIdFromWebhook,
};
