/**
 * Controlador de pagos a cuotas (Addi y Sistecrédito).
 *
 * Reemplaza al antiguo addiController, que era un simulacro: construía una URL
 * de retorno con `status=APPROVED` incrustado, el navegador la seguía, y el
 * backend creía ese parámetro. Resultado: la orden se pagaba sola sin que Addi
 * llegara a abrirse siquiera, y cualquiera podía marcar cualquier orden como
 * pagada con un POST.
 *
 * Reglas que este controlador respeta sin excepción:
 *
 *   1. El estado SIEMPRE se consulta contra la API del financiador. Ni la URL
 *      de retorno ni el cuerpo del webhook pueden aprobar nada por sí solos.
 *   2. El applicationId se lee de la base de datos, nunca del cliente.
 *   3. Si el proveedor no está completamente configurado, la ruta responde 503
 *      y el botón ni siquiera se muestra en el checkout.
 *   4. Confirmar una orden es idempotente y pasa por markOrderAsPaid.
 */

const crypto = require('crypto');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const addiService = require('../services/addiService');
const sistecreditoService = require('../services/sistecreditoService');
const { markOrderAsPaid } = require('../utils/orderFulfillment');
const { PAYMENT_METHODS, normalizePaymentMethod, surchargePercent } = require('../config/payments');

const PROVIDERS = {
    ADDI: addiService,
    SISTECREDITO: sistecreditoService,
};

/**
 * El simulador permite probar el flujo completo en local sin credenciales.
 * Nunca aprueba solo: abre una pantalla donde hay que elegir explícitamente, y
 * las órdenes que confirma quedan marcadas y no se envían a contabilidad.
 * Queda deshabilitado por completo en producción.
 */
const simulatorEnabled = () =>
    process.env.NODE_ENV !== 'production' &&
    String(process.env.PAYMENTS_SIMULATOR || '').toLowerCase() === 'true';

const getProvider = (raw) => {
    const code = normalizePaymentMethod(raw);
    return code && PROVIDERS[code] ? { code, service: PROVIDERS[code] } : null;
};

const frontendUrl = () => (process.env.FRONTEND_URL || '').replace(/["']/g, '').replace(/\/+$/, '');
const backendUrl = () =>
    (process.env.API_URL || process.env.BACKEND_URL || '').replace(/["']/g, '').replace(/\/+$/, '');

/**
 * Comprueba las credenciales con las que el financiador llama a nuestro webhook.
 *
 * Acepta HTTP Basic Auth (lo que usa Addi con sus "credenciales de notificacion")
 * y, como alternativa, un secreto plano en cabecera para financiadores que
 * trabajen asi.
 *
 * Si el comercio no configuro credenciales, no se bloquea la llamada: el estado
 * se vuelve a consultar contra el API del financiador de todos modos, asi que un
 * webhook falso no puede aprobar nada. Estas credenciales evitan el ruido, no
 * son la barrera de seguridad.
 */
const verifyWebhookAuth = (providerCode, req) => {
    const user = process.env[`${providerCode}_WEBHOOK_USER`];
    const password = process.env[`${providerCode}_WEBHOOK_PASSWORD`];
    const secret = process.env[`${providerCode}_WEBHOOK_SECRET`];

    if (!user && !password && !secret) return true; // sin configurar: no se exige

    const header = req.headers['authorization'] || '';

    if (user && password) {
        if (!header.toLowerCase().startsWith('basic ')) return false;
        let decoded;
        try {
            decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
        } catch {
            return false;
        }
        // El usuario no lleva ':', asi que se parte en el primero.
        const sep = decoded.indexOf(':');
        if (sep === -1) return false;
        return (
            safeEqual(decoded.slice(0, sep), user) &&
            safeEqual(decoded.slice(sep + 1), password)
        );
    }

    const received = req.headers['x-webhook-secret'] || req.headers['x-addi-signature'] || header;
    return Boolean(received) && safeEqual(String(received).trim(), secret);
};

/** Comparacion en tiempo constante, para no filtrar el secreto por temporizacion. */
const safeEqual = (a, b) => {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
};

const splitName = (fullName = '') => {
    const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] || 'Cliente',
        lastName: parts.slice(1).join(' ') || parts[0] || 'Cliente',
    };
};

// ── Métodos de pago disponibles ──────────────────────────────────────────────

/**
 * @desc    Qué medios de pago puede mostrar el checkout
 * @route   GET /api/payments/methods
 * @access  Público
 */
exports.getAvailableMethods = (req, res) => {
    const simulator = simulatorEnabled();

    const methods = [
        {
            ...PAYMENT_METHODS.WOMPI,
            surchargePercent: surchargePercent('WOMPI'),
            available: Boolean(process.env.WOMPI_PUBLIC_KEY && process.env.WOMPI_INTEGRITY_SECRET),
        },
        {
            ...PAYMENT_METHODS.ADDI,
            ...addiService.publicConfig(),
            surchargePercent: surchargePercent('ADDI'),
            available: addiService.isConfigured() || simulator,
            simulated: !addiService.isConfigured() && simulator,
        },
        {
            ...PAYMENT_METHODS.SISTECREDITO,
            ...sistecreditoService.publicConfig(),
            surchargePercent: surchargePercent('SISTECREDITO'),
            available: sistecreditoService.isConfigured() || simulator,
            simulated: !sistecreditoService.isConfigured() && simulator,
        },
    ];

    res.json({ methods: methods.filter((m) => m.available), simulator });
};

// ── 1. Crear la solicitud de crédito ─────────────────────────────────────────

/**
 * @desc    Crea la solicitud en el financiador y devuelve su URL real
 * @route   POST /api/payments/credit/:provider/create
 * @access  Privado
 */
exports.createApplication = async (req, res) => {
    try {
        const provider = getProvider(req.params.provider || req.body.provider);
        if (!provider) {
            return res.status(400).json({ msg: 'Proveedor de crédito no válido' });
        }

        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ msg: 'Falta el identificador de la orden' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ msg: 'Orden no encontrada' });
        }

        // El dueño de la orden es el único que puede pagarla.
        if (order.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado sobre esta orden' });
        }

        if (order.isPaid) {
            return res.status(409).json({ msg: 'Esta orden ya fue pagada' });
        }

        const configured = provider.service.isConfigured();
        if (!configured && !simulatorEnabled()) {
            console.error(`[Cuotas] ${provider.code} no está configurado (revisa el .env).`);
            return res.status(503).json({
                msg: `El pago a cuotas con ${PAYMENT_METHODS[provider.code].label} no está disponible en este momento.`,
            });
        }

        const limits = provider.service.publicConfig();
        const amount = Math.round(Number(order.totalPrice));
        if (amount < limits.minAmount || amount > limits.maxAmount) {
            return res.status(422).json({
                msg: `${PAYMENT_METHODS[provider.code].label} aplica para compras entre $${limits.minAmount.toLocaleString('es-CO')} y $${limits.maxAmount.toLocaleString('es-CO')}.`,
            });
        }

        const legalId = order.shippingAddress?.legalId;
        if (!legalId) {
            return res.status(422).json({
                msg: 'Para pagar a cuotas necesitamos tu número de cédula en los datos de envío.',
            });
        }

        const user = await User.findById(order.user).select('name email');
        const { firstName, lastName } = splitName(order.shippingAddress?.fullName || user?.name);

        const customer = {
            firstName,
            lastName,
            email: order.shippingAddress?.email || user?.email,
            phone: String(order.shippingAddress?.phone || '').replace(/\D/g, ''),
            idNumber: String(legalId).replace(/\D/g, ''),
            idType: 'CC',
        };

        // Los financiadores exigen SKU real por ítem.
        const items = [];
        for (const item of order.orderItems) {
            const productDoc = await Product.findById(item.product).select('sku name category');
            items.push({
                sku: productDoc?.sku || item.product.toString(),
                name: item.name,
                quantity: item.quantity,
                price: item.price,
                image: item.image,
                category: productDoc?.category || 'general',
            });
        }

        const redirectUrl = `${frontendUrl()}/order/${order._id}/credit-result?provider=${provider.code}`;
        const webhookUrl = `${backendUrl()}/api/payments/credit/${provider.code.toLowerCase()}/webhook`;

        let applicationId;
        let applicationUrl;
        let simulated = false;

        if (configured) {
            const result = await provider.service.createApplication({
                order,
                customer,
                redirectUrl,
                webhookUrl,
                items,
            });
            applicationId = result.applicationId;
            applicationUrl = result.applicationUrl;
        } else {
            // Modo simulador: pantalla propia que exige una decisión manual.
            simulated = true;
            applicationId = `sim_${crypto.randomBytes(10).toString('hex')}`;
            applicationUrl = `${frontendUrl()}/order/${order._id}/credit-simulator?provider=${provider.code}&applicationId=${applicationId}`;
            console.warn(`[Cuotas] SIMULADOR activo para ${provider.code}. Orden ${order._id}.`);
        }

        order.paymentMethod = provider.code;
        order.creditApplication = {
            provider: provider.code,
            applicationId,
            status: 'PENDING',
            rawStatus: 'CREATED',
            redirectUrl: applicationUrl,
            simulated,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        await order.save();

        res.json({
            provider: provider.code,
            applicationId,
            applicationUrl,
            simulated,
        });
    } catch (error) {
        // Se clasifica el fallo porque cada causa se arregla en un sitio
        // distinto, y desde el navegador todas se veian igual: un 502 opaco.
        const status = error.response?.status;
        const stage = error.stage || 'DESCONOCIDO';

        let reason = 'DESCONOCIDO';
        let pista = '';

        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
            reason = 'RED';
            pista = 'El servidor no logro salir a internet hacia el financiador. Revisa DNS o el cortafuegos de salida del hosting.';
        } else if (stage === 'AUTH') {
            reason = 'CREDENCIALES';
            pista = 'El financiador rechazo las credenciales. Suele ser el CLIENT_ID/CLIENT_SECRET mal copiado, o credenciales de un ambiente (pruebas/produccion) contra las URLs del otro.';
        } else if (stage === 'URL_API') {
            reason = 'URL_API';
            pista = 'La URL configurada devolvio una pagina web en vez de JSON: no es el endpoint del API. Corrige ADDI_API_URL / ADDI_CREATE_PATH con lo que diga el manual de integracion.';
        } else if (stage === 'CONTRACT' || (stage === 'CREATE' && status && status >= 400 && status < 500)) {
            reason = 'CONTRATO';
            pista = 'El financiador rechazo los datos de la solicitud. El contrato del API no coincide con lo implementado: revisa el detalle de abajo para ver que campo reclama.';
        } else if (status && status >= 500) {
            reason = 'FINANCIADOR';
            pista = 'El financiador respondio con un error propio. Suele ser temporal.';
        }

        const detail = error.response?.data
            ? JSON.stringify(error.response.data).slice(0, 800)
            : error.message;

        console.error(
            `[Cuotas] Fallo creando la solicitud | proveedor=${req.params.provider} | causa=${reason} | paso=${stage} | http=${status || 'n/a'}`
        );
        console.error('[Cuotas] Respuesta del financiador:', detail);
        if (pista) console.error('[Cuotas]', pista);

        res.status(502).json({
            msg: 'No pudimos iniciar tu solicitud de crédito. Intenta de nuevo o elige otro medio de pago.',
            // Categoria, sin datos sensibles: permite diagnosticar desde la
            // consola del navegador sin tener que entrar a los logs del hosting.
            reason,
            // Solo en errores de contrato: el financiador esta diciendo que campo
            // le falta o no le cuadra. Son mensajes de validacion de esquema, no
            // llevan credenciales ni datos del cliente, y sin ellos hay que ir a
            // buscar los logs del hosting para avanzar un paso.
            ...(reason === 'CONTRATO' || reason === 'URL_API' ? { detail } : {}),
        });
    }
};

// ── 2. Verificar el estado (fuente de verdad) ────────────────────────────────

/**
 * Consulta el estado real y, si está aprobado, completa la orden.
 * Función interna reutilizada por la verificación del frontend y por el webhook.
 */
const resolveOrderStatus = async (order) => {
    const application = order.creditApplication;

    if (!application?.applicationId || !application?.provider) {
        return { status: 'NOT_STARTED', order };
    }

    if (order.isPaid) {
        return { status: 'APPROVED', order };
    }

    // Simulador: el estado lo fijó una decisión manual, no hay API que consultar.
    if (application.simulated) {
        if (application.status === 'APPROVED') {
            await markOrderAsPaid(order, {
                method: application.provider,
                transactionId: application.applicationId,
                rawStatus: 'SIMULATED_APPROVED',
                customerEmail: order.shippingAddress?.email,
            });
        }
        return { status: application.status || 'PENDING', order };
    }

    const service = PROVIDERS[application.provider];
    if (!service) {
        return { status: 'PENDING', order };
    }

    const result = await service.getApplicationStatus(application.applicationId, {
        orderId: order._id.toString(),
    });

    order.creditApplication.status = result.status;
    order.creditApplication.rawStatus = result.rawStatus;
    order.creditApplication.updatedAt = new Date();
    await order.save();

    if (result.status === 'APPROVED') {
        await markOrderAsPaid(order, {
            method: application.provider,
            transactionId: result.transactionId,
            rawStatus: result.rawStatus,
            customerEmail: order.shippingAddress?.email,
        });
    }

    return { status: result.status, order };
};

/**
 * @desc    Verifica el estado de la solicitud de una orden
 * @route   POST /api/payments/credit/verify
 * @access  Privado
 *
 * Recibe únicamente el orderId. El applicationId y el estado salen de la base de
 * datos y del financiador, nunca del cliente.
 */
exports.verifyApplication = async (req, res) => {
    try {
        const orderId = req.body.orderId || req.params.orderId;
        if (!orderId) {
            return res.status(400).json({ msg: 'Falta el identificador de la orden' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ msg: 'Orden no encontrada' });
        }

        if (order.user.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ msg: 'No autorizado sobre esta orden' });
        }

        const { status } = await resolveOrderStatus(order);

        res.json({
            status,
            isPaid: order.isPaid,
            orderId: order._id,
            provider: order.creditApplication?.provider || null,
        });
    } catch (error) {
        const detail = error.response?.data
            ? JSON.stringify(error.response.data).slice(0, 500)
            : error.message;
        console.error('[Cuotas] Error verificando la solicitud:', detail);
        res.status(502).json({ msg: 'No pudimos confirmar el estado de tu crédito. Intenta de nuevo.' });
    }
};

// ── 3. Webhook ───────────────────────────────────────────────────────────────

/**
 * @desc    Notificación del financiador
 * @route   POST /api/payments/credit/:provider/webhook
 * @access  Público
 *
 * El webhook se trata como un simple aviso de "algo cambió": nunca se lee el
 * estado que trae. Se ubica la orden y se vuelve a consultar la API oficial.
 * Así, aunque la firma del webhook cambie o alguien lo falsifique, no se puede
 * aprobar una orden que el financiador no aprobó.
 */
exports.handleWebhook = async (req, res) => {
    try {
        const provider = getProvider(req.params.provider);
        if (!provider) {
            return res.sendStatus(400);
        }

        // Addi entrega unas "credenciales de notificacion" (usuario y contrasena)
        // aparte de las de operacion, y llama a este webhook con HTTP Basic Auth.
        //
        // La version anterior buscaba la contrasena en texto plano dentro de la
        // cabecera Authorization, cosa que nunca habria funcionado: Basic Auth la
        // manda en base64. Habria rechazado todas las notificaciones legitimas.
        if (!verifyWebhookAuth(provider.code, req)) {
            console.error(`[Cuotas] Webhook de ${provider.code} con credenciales invalidas.`);
            return res.sendStatus(401);
        }

        const applicationId = provider.service.extractApplicationIdFromWebhook(req.body);
        const orderId = provider.service.extractOrderIdFromWebhook(req.body);

        let order = null;
        if (applicationId) {
            order = await Order.findOne({ 'creditApplication.applicationId': applicationId });
        }
        if (!order && orderId && /^[0-9a-fA-F]{24}$/.test(String(orderId))) {
            order = await Order.findById(orderId);
        }

        if (!order) {
            console.warn(`[Cuotas] Webhook de ${provider.code} sin orden asociada.`);
            return res.sendStatus(200); // 200 para que el financiador no reintente en bucle
        }

        const { status } = await resolveOrderStatus(order);
        console.log(`[Cuotas] Webhook ${provider.code}: orden ${order._id} quedó en ${status}.`);

        res.sendStatus(200);
    } catch (error) {
        console.error('[Cuotas] Error procesando el webhook:', error.message);
        res.sendStatus(200);
    }
};

// ── 4. Simulador (solo fuera de producción) ──────────────────────────────────

/**
 * @desc    Registra una decisión manual en el simulador de pruebas
 * @route   POST /api/payments/credit/simulator/decide
 * @access  Privado
 */
exports.simulatorDecide = async (req, res) => {
    try {
        if (!simulatorEnabled()) {
            return res.status(403).json({ msg: 'El simulador de pagos está deshabilitado' });
        }

        const { orderId, decision } = req.body;
        const normalized = String(decision || '').toUpperCase();

        if (!['APPROVED', 'REJECTED', 'CANCELLED'].includes(normalized)) {
            return res.status(400).json({ msg: 'Decisión no válida' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ msg: 'Orden no encontrada' });
        if (order.user.toString() !== req.user.id) {
            return res.status(403).json({ msg: 'No autorizado sobre esta orden' });
        }
        if (!order.creditApplication?.simulated) {
            return res.status(400).json({ msg: 'Esta orden no pertenece al simulador' });
        }

        order.creditApplication.status = normalized;
        order.creditApplication.rawStatus = `SIMULATED_${normalized}`;
        order.creditApplication.updatedAt = new Date();
        await order.save();

        const { status } = await resolveOrderStatus(order);
        res.json({ status, isPaid: order.isPaid });
    } catch (error) {
        console.error('[Cuotas] Error en el simulador:', error.message);
        res.status(500).json({ msg: 'Error en el simulador de pagos' });
    }
};

exports._resolveOrderStatus = resolveOrderStatus;
