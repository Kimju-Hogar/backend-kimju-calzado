/**
 * Integración REAL con Addi (crédito a cuotas).
 *
 * Flujo oficial de Addi:
 *   1. OAuth client_credentials contra el auth server  -> access_token
 *   2. POST /v1/online-applications                     -> { applicationId, redirectionUrl }
 *   3. El cliente completa su solicitud EN EL SITIO DE ADDI
 *   4. Addi redirige de vuelta a la tienda y/o dispara un webhook
 *   5. La tienda CONSULTA el estado contra la API de Addi -> APPROVED / REJECTED / ...
 *
 * REGLA DE ORO: el paso 5 es la única fuente de verdad. Nunca se marca una orden
 * como pagada por lo que diga la URL de retorno ni por el cuerpo del webhook.
 */

const axios = require('axios');

const TIMEOUT_MS = Number(process.env.ADDI_TIMEOUT_MS || 20000);

// Token cacheado en memoria para no pedir uno en cada request.
let tokenCache = { value: null, expiresAt: 0 };

const config = () => ({
    enabled: String(process.env.ADDI_ENABLED || '').toLowerCase() === 'true',
    clientId: (process.env.ADDI_CLIENT_ID || '').trim(),
    clientSecret: (process.env.ADDI_CLIENT_SECRET || '').trim(),
    authUrl: (process.env.ADDI_AUTH_URL || 'https://auth.addi.com/oauth/token').trim(),
    audience: (process.env.ADDI_AUDIENCE || 'https://api.addi.com').trim(),
    apiUrl: (process.env.ADDI_API_URL || 'https://api.addi.com').replace(/\/+$/, ''),
    allySlug: (process.env.ADDI_ALLY_SLUG || '').trim(),
    minAmount: Number(process.env.ADDI_MIN_AMOUNT || 150000),
    maxAmount: Number(process.env.ADDI_MAX_AMOUNT || 6000000),
});

// ¿Está el proveedor listo para usarse? Si no, el botón ni siquiera se muestra.
const isConfigured = () => {
    const cfg = config();
    return Boolean(cfg.enabled && cfg.clientId && cfg.clientSecret && cfg.authUrl && cfg.apiUrl);
};

const publicConfig = () => {
    const cfg = config();
    return {
        code: 'ADDI',
        available: isConfigured(),
        minAmount: cfg.minAmount,
        maxAmount: cfg.maxAmount,
    };
};

/**
 * Traduce el estado crudo de Addi a nuestro vocabulario interno.
 * Cualquier estado desconocido se trata como PENDING, nunca como aprobado.
 */
const normalizeStatus = (rawStatus) => {
    const status = String(rawStatus || '').trim().toUpperCase();
    if (['APPROVED', 'ACCEPTED', 'DISBURSED', 'CONFIRMED'].includes(status)) return 'APPROVED';
    if (['REJECTED', 'DECLINED', 'DENIED'].includes(status)) return 'REJECTED';
    if (['CANCELLED', 'CANCELED', 'ABANDONED', 'DECLINED_BY_USER'].includes(status)) return 'CANCELLED';
    if (['EXPIRED', 'TIMED_OUT'].includes(status)) return 'EXPIRED';
    return 'PENDING';
};

// Etiqueta el error con el paso en el que ocurrio. Sin esto, desde fuera es
// imposible distinguir "las credenciales estan mal" de "el contrato del API no
// coincide", que se arreglan de formas muy distintas.
const tag = (err, stage) => {
    if (!err.stage) err.stage = stage;
    return err;
};

const getAccessToken = async () => {
    const cfg = config();
    const now = Date.now();

    if (tokenCache.value && tokenCache.expiresAt > now + 30000) {
        return tokenCache.value;
    }

    let data;
    try {
        ({ data } = await axios.post(
        cfg.authUrl,
        {
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            audience: cfg.audience,
            grant_type: 'client_credentials',
        },
        { timeout: TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
        ));
    } catch (err) {
        throw tag(err, 'AUTH');
    }

    const accessToken = data.access_token || data.accessToken;
    if (!accessToken) {
        const err = new Error('Addi no devolvio un access_token');
        err.stage = 'AUTH';
        throw err;
    }

    const expiresInSeconds = Number(data.expires_in || 3600);
    tokenCache = { value: accessToken, expiresAt: now + expiresInSeconds * 1000 };
    return accessToken;
};

const authorizedHeaders = async () => ({
    Authorization: `Bearer ${await getAccessToken()}`,
    'Content-Type': 'application/json',
});

/**
 * Crea la solicitud de crédito y devuelve la URL de Addi a la que hay que
 * enviar al cliente.
 */
const createApplication = async ({ order, customer, redirectUrl, webhookUrl, items }) => {
    const cfg = config();

    // Addi espera los datos de la persona dentro de la direccion, no solo las
    // lineas. Enviar solo line1/city/state es lo que hace que rechace la
    // solicitud por esquema.
    const address = {
        firstName: customer.firstName,
        lastName: customer.lastName,
        email: customer.email,
        cellphone: customer.phone,
        line1: order.shippingAddress?.address || '',
        line2: order.shippingAddress?.additionalInfo || '',
        city: order.shippingAddress?.city || '',
        state: order.shippingAddress?.state || '',
        country: 'CO',
        zipCode: order.shippingAddress?.postalCode || '000000',
    };

    const payload = {
        orderId: order._id.toString(),
        totalAmount: Math.round(Number(order.totalPrice)),
        shippingAmount: Math.round(Number(order.shippingPrice || 0)),
        totalTaxesAmount: Math.round(Number(order.taxPrice || 0)),
        totalDiscountAmount: 0,
        currency: 'COP',
        ...(cfg.allySlug ? { allySlug: cfg.allySlug } : {}),
        items: items.map((item) => ({
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: Math.round(Number(item.price)),
            tax: 0,
            category: item.category || 'general',
            ...(item.image ? { pictureUrl: item.image } : {}),
        })),
        client: {
            idType: customer.idType || 'CC',
            idNumber: customer.idNumber,
            firstName: customer.firstName,
            lastName: customer.lastName,
            email: customer.email,
            cellphone: customer.phone,
        },
        shippingAddress: address,
        billingAddress: address,
        allyUrlRedirection: {
            ...(process.env.STORE_LOGO_URL ? { logoUrl: process.env.STORE_LOGO_URL } : {}),
            callbackUrl: webhookUrl,
            redirectionUrl: redirectUrl,
        },
    };

    const headers = await authorizedHeaders(); // si falla aqui, va etiquetado AUTH

    let data;
    try {
        ({ data } = await axios.post(`${cfg.apiUrl}/v1/online-applications`, payload, {
            timeout: TIMEOUT_MS,
            headers,
        }));
    } catch (err) {
        throw tag(err, 'CREATE');
    }

    const applicationId = data.applicationId || data.id || data.applicationID;
    const applicationUrl = data.redirectionUrl || data.applicationUrl || data.url;

    if (!applicationId || !applicationUrl) {
        throw tag(
            new Error(
                `Respuesta inesperada de Addi al crear la solicitud: ${JSON.stringify(data).slice(0, 500)}`
            ),
            'CONTRACT'
        );
    }

    return { applicationId, applicationUrl, raw: data };
};

/**
 * Consulta el estado real de una solicitud contra la API de Addi.
 * Es la ÚNICA función autorizada para decidir si una orden quedó aprobada.
 */
const getApplicationStatus = async (applicationId) => {
    const cfg = config();

    const { data } = await axios.get(`${cfg.apiUrl}/v1/applications/${applicationId}`, {
        timeout: TIMEOUT_MS,
        headers: await authorizedHeaders(),
    });

    const rawStatus = data.status || data.applicationStatus || data.state;

    return {
        status: normalizeStatus(rawStatus),
        rawStatus: String(rawStatus || 'UNKNOWN'),
        transactionId: data.applicationId || applicationId,
        raw: data,
    };
};

// Extrae el applicationId del cuerpo de un webhook de Addi.
const extractApplicationIdFromWebhook = (body = {}) =>
    body.applicationId ||
    body.application_id ||
    body.id ||
    body?.data?.applicationId ||
    body?.application?.id ||
    null;

// Respaldo: algunos eventos traen solo el orderId.
const extractOrderIdFromWebhook = (body = {}) =>
    body.orderId || body.order_id || body?.data?.orderId || null;

module.exports = {
    code: 'ADDI',
    isConfigured,
    publicConfig,
    config,
    normalizeStatus,
    createApplication,
    getApplicationStatus,
    extractApplicationIdFromWebhook,
    extractOrderIdFromWebhook,

    // Solo para scripts/verificar-addi.js: permite comprobar credenciales y
    // ambiente sin llegar a crear ninguna solicitud de credito.
    __getAccessTokenForCheck: getAccessToken,
};
