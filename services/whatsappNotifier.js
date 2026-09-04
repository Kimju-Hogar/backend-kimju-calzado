/**
 * Aviso por WhatsApp cuando entra una venta.
 *
 * Está montado detrás de una interfaz con dos implementaciones, para que pasar
 * de CallMeBot a la API oficial de Meta sea cambiar variables de entorno y no
 * tocar código:
 *
 *   WHATSAPP_PROVIDER=callmebot   (hoy: montaje en 5 minutos, no oficial)
 *   WHATSAPP_PROVIDER=meta        (cuando termine el trámite de Meta Business)
 *   WHATSAPP_PROVIDER=none        (apagado; también si falta configuración)
 *
 * REGLA: notificar nunca puede tumbar una venta. Todo lo de aquí va envuelto en
 * try/catch y falla en silencio con un log. Si WhatsApp está caído, la orden se
 * confirma igual.
 *
 * ── Cómo obtener la clave de CallMeBot ──────────────────────────────────────
 *   1. Guarda el número +34 644 51 95 23 en tus contactos (nombre: CallMeBot).
 *   2. Mándale por WhatsApp: «I allow callmebot to send me messages»
 *   3. Te responde con tu apikey. Va en CALLMEBOT_APIKEY.
 *   4. WHATSAPP_TO es tu número con indicativo y sin signos: 573001234567
 *
 * CallMeBot es un servicio de terceros no oficial: puede dejar de funcionar sin
 * aviso, y manda los mensajes a través de su propia infraestructura. Sirve para
 * avisarte a ti mismo mientras sale lo de Meta; no lo uses para escribirle a
 * clientes.
 */

const axios = require('axios');

const TIMEOUT_MS = Number(process.env.WHATSAPP_TIMEOUT_MS || 10000);

const config = () => ({
    provider: String(process.env.WHATSAPP_PROVIDER || 'none').trim().toLowerCase(),
    to: String(process.env.WHATSAPP_TO || '').replace(/[^\d]/g, ''),
    // CallMeBot
    callmebotKey: String(process.env.CALLMEBOT_APIKEY || '').trim(),
    // Meta Cloud API
    metaPhoneId: String(process.env.META_PHONE_NUMBER_ID || '').trim(),
    metaToken: String(process.env.META_TOKEN || '').trim(),
    metaVersion: String(process.env.META_API_VERSION || 'v21.0').trim(),
    metaTemplate: String(process.env.META_TEMPLATE_NAME || '').trim(),
});

const isConfigured = () => {
    const cfg = config();
    if (!cfg.to) return false;
    if (cfg.provider === 'callmebot') return Boolean(cfg.callmebotKey);
    if (cfg.provider === 'meta') return Boolean(cfg.metaPhoneId && cfg.metaToken);
    return false;
};

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

/**
 * Texto del aviso.
 *
 * Corto a propósito: CallMeBot manda el mensaje dentro de la URL, y una URL muy
 * larga se corta. Lo que va aquí es lo que se necesita para reaccionar sin
 * entrar al panel; el detalle completo está en el correo y en el Panel.
 */
const buildMessage = (order, { store } = {}) => {
    const envio = order.shippingAddress || {};
    const items = order.orderItems || [];

    const lineas = items
        .slice(0, 6)
        .map((i) => `• ${i.quantity}x ${i.name}${i.selectedVariation ? ` (${i.selectedVariation})` : ''}`);

    if (items.length > 6) lineas.push(`• …y ${items.length - 6} más`);

    const recargo =
        order.surcharge?.amount > 0
            ? `\nRecargo ${order.surcharge.percentage}%: ${pesos(order.surcharge.amount)}`
            : '';

    return [
        `🛒 NUEVA VENTA — ${store || order.store || 'Tienda'}`,
        ``,
        `${pesos(order.totalPrice)} · ${order.paymentMethod || 'N/D'}${recargo}`,
        ``,
        lineas.join('\n'),
        ``,
        `👤 ${envio.fullName || 'Cliente'}`,
        `📞 ${envio.phone || 'sin teléfono'}`,
        `📍 ${envio.address || ''}${envio.city ? `, ${envio.city}` : ''}`,
        ``,
        `#${String(order._id).slice(-8)}`,
    ]
        .filter((l) => l !== undefined)
        .join('\n');
};

const sendViaCallmebot = async (text) => {
    const cfg = config();
    const url =
        `https://api.callmebot.com/whatsapp.php` +
        `?phone=${encodeURIComponent(cfg.to)}` +
        `&text=${encodeURIComponent(text)}` +
        `&apikey=${encodeURIComponent(cfg.callmebotKey)}`;

    const { status, data } = await axios.get(url, {
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
    });

    const cuerpo = typeof data === 'string' ? data : JSON.stringify(data);

    // CallMeBot responde 200 con un texto de error, no con un código HTTP.
    if (status !== 200 || /error|invalid|not authorized/i.test(cuerpo)) {
        throw new Error(`CallMeBot rechazó el envío (HTTP ${status}): ${cuerpo.slice(0, 200)}`);
    }

    return true;
};

const sendViaMeta = async (text) => {
    const cfg = config();
    const url = `https://graph.facebook.com/${cfg.metaVersion}/${cfg.metaPhoneId}/messages`;

    // Meta solo permite texto libre dentro de las 24 h siguientes a un mensaje
    // del destinatario. Para avisos que inicia el negocio hay que usar una
    // plantilla aprobada; por eso META_TEMPLATE_NAME manda cuando está puesta.
    const payload = cfg.metaTemplate
        ? {
              messaging_product: 'whatsapp',
              to: cfg.to,
              type: 'template',
              template: {
                  name: cfg.metaTemplate,
                  language: { code: 'es' },
                  components: [{ type: 'body', parameters: [{ type: 'text', text }] }],
              },
          }
        : {
              messaging_product: 'whatsapp',
              to: cfg.to,
              type: 'text',
              text: { body: text },
          };

    await axios.post(url, payload, {
        timeout: TIMEOUT_MS,
        headers: {
            Authorization: `Bearer ${cfg.metaToken}`,
            'Content-Type': 'application/json',
        },
    });

    return true;
};

/**
 * Avisa de una venta nueva. No lanza nunca: una notificación fallida no puede
 * impedir que la orden quede confirmada.
 */
const notifyNewOrder = async (order, { store } = {}) => {
    const cfg = config();

    if (cfg.provider === 'none' || !cfg.provider) return false;

    if (!isConfigured()) {
        console.warn(
            `[WhatsApp] Proveedor "${cfg.provider}" incompleto (falta WHATSAPP_TO o las credenciales). No se envía.`
        );
        return false;
    }

    try {
        const text = buildMessage(order, { store });

        if (cfg.provider === 'callmebot') await sendViaCallmebot(text);
        else if (cfg.provider === 'meta') await sendViaMeta(text);
        else {
            console.warn(`[WhatsApp] Proveedor desconocido: "${cfg.provider}"`);
            return false;
        }

        console.log(`[WhatsApp] Aviso enviado por la orden ${order._id}`);
        return true;
    } catch (error) {
        const detalle = error.response?.data
            ? JSON.stringify(error.response.data).slice(0, 300)
            : error.message;
        console.error(`[WhatsApp] No se pudo avisar de la orden ${order._id}: ${detalle}`);
        return false;
    }
};

module.exports = { notifyNewOrder, buildMessage, isConfigured, config };
