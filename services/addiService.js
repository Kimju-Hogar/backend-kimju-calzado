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
    apiUrl: (process.env.ADDI_API_URL || 'https://api.addi.com')
        .replace(/["']/g, '')
        .trim()
        .replace(/\/+$/, ''),
    allySlug: (process.env.ADDI_ALLY_SLUG || '').trim(),
    createPath: (process.env.ADDI_CREATE_PATH || '/v1/online-applications').trim(),
    statusPath: (process.env.ADDI_STATUS_PATH || '/v1/applications/{id}').trim(),
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

    if (looksLikeWebPage(data)) throw urlError(cfg.authUrl, data);

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

/**
 * Detecta que el host respondio con una pagina web en vez de JSON.
 *
 * Paso de verdad: con ADDI_API_URL=https://api.addi.com la peticion devolvia
 * 200 y el HTML de un sitio Next.js. El error resultante ("falta applicationId")
 * apuntaba al esquema del payload, cuando en realidad la URL no era la de la
 * API. Este chequeo lo dice explicitamente.
 */
const looksLikeWebPage = (data) =>
    typeof data === 'string' && /^\s*(<!DOCTYPE|<html)/i.test(data);

const urlError = (url, data, res) => {
    const tipo = res?.headers?.['content-type'] || 'desconocido';
    const err = new Error(
        `${url} respondio HTTP ${res?.status ?? '?'} con content-type "${tipo}" ` +
        `y el cuerpo es una pagina web, no JSON. ` +
        `Recibido: ${String(data).slice(0, 120)}`
    );
    err.stage = 'URL_API';
    return err;
};

/**
 * Identificador de la solicitud cuando Addi responde con una redireccion.
 *
 * En ese caso no hay cuerpo JSON del que sacarlo, asi que se busca por orden:
 * una cabecera propia de Addi, el codigo corto de la URL
 * (https://urlv2.addi.com/P5pwjc -> P5pwjc) y, como ultimo recurso, el orderId,
 * que siempre conocemos y que Addi tambien recibe.
 */
const applicationIdFrom = (headers = {}, location = '', orderId = '') => {
    const fromHeader =
        headers['x-application-id'] ||
        headers['application-id'] ||
        headers['x-addi-application-id'];
    if (fromHeader) return String(fromHeader);

    const shortCode = String(location).split('/').filter(Boolean).pop();
    if (shortCode && shortCode.length <= 40) return shortCode;

    return String(orderId);
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
    const url = `${cfg.apiUrl}${cfg.createPath}`;

    let res;
    try {
        res = await axios.post(url, payload, {
            timeout: TIMEOUT_MS,
            headers,
            // No seguir la redireccion, por dos motivos.
            //
            // El primero es que esta integracion responde 301 con la URL de la
            // solicitud en la cabecera Location: seguirla convierte el POST en
            // GET y aterriza en la web de Addi, que devuelve 200 y una pagina
            // HTML. Ese era el "error de contrato" que no habia forma de
            // diagnosticar: la solicitud se creaba bien y se perdia la URL.
            //
            // El segundo es que una redireccion inesperada ahora se ve, en vez
            // de disfrazarse de respuesta valida.
            maxRedirects: 0,
            validateStatus: (s) => s >= 200 && s < 400,
        });
    } catch (err) {
        if (err.stage) throw err;
        throw tag(err, 'CREATE');
    }

    // Caso 1: 3xx con Location. La URL de la solicitud viene en la cabecera.
    if (res.status >= 300 && res.status < 400) {
        const location = res.headers?.location;
        if (!location) {
            const e = new Error(
                `${url} respondio HTTP ${res.status} sin cabecera Location, ` +
                `asi que no hay a donde enviar al cliente.`
            );
            e.stage = 'CONTRACT';
            throw e;
        }

        return {
            applicationId: applicationIdFrom(res.headers, location, payload.orderId),
            applicationUrl: location,
            raw: { status: res.status, location, headers: res.headers },
        };
    }

    // Caso 2: 2xx con JSON, que es como responde la integracion estandar.
    const data = res.data;

    if (looksLikeWebPage(data)) throw urlError(url, data, res);

    const applicationId =
        data.applicationId || data.id || data.applicationID || payload.orderId;
    const applicationUrl = data.redirectionUrl || data.applicationUrl || data.url;

    if (!applicationUrl) {
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
const getApplicationStatus = async (applicationId, { orderId } = {}) => {
    const cfg = config();

    const consultar = async (id) => {
        const url = `${cfg.apiUrl}${cfg.statusPath.replace('{id}', encodeURIComponent(id))}`;
        const r = await axios.get(url, { timeout: TIMEOUT_MS, headers: await authorizedHeaders() });
        if (looksLikeWebPage(r.data)) throw urlError(url, r.data, r);
        return r.data;
    };

    let data;
    try {
        data = await consultar(applicationId);
    } catch (err) {
        // Cuando la solicitud se creo por redireccion, el identificador guardado
        // puede ser el codigo corto de la URL, que no sirve para consultar. El
        // orderId si viaja en la solicitud, asi que se reintenta con el.
        const noEncontrado = err.response?.status === 404 || err.response?.status === 400;
        if (!noEncontrado || !orderId || orderId === applicationId) throw err;

        console.warn(
            `[Addi] Estado no encontrado por applicationId "${applicationId}". Reintentando por orderId.`
        );
        data = await consultar(orderId);
    }

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
