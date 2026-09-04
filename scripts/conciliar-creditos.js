/**
 * Conciliación de solicitudes de crédito pendientes.
 *
 *   node scripts/conciliar-creditos.js            (revisa y arregla)
 *   node scripts/conciliar-creditos.js --dry-run  (solo informa, no toca nada)
 *   node scripts/conciliar-creditos.js --dias 30  (cuántos días atrás mirar)
 *
 * POR QUÉ EXISTE
 *
 * Una orden a cuotas se confirma por dos vías: el cliente vuelve del sitio del
 * financiador, o llega el webhook. Las dos fallan a menudo — el cliente cierra
 * la pestaña, se le acaba el saldo, el webhook no está registrado o se pierde.
 * Cuando eso pasa la orden se queda en PENDING para siempre: el cliente ya pagó
 * y le aprobaron el crédito, pero en la tienda no hay correo de confirmación,
 * el stock no baja y la venta nunca llega al Panel.
 *
 * Este script cierra ese hueco preguntándole al financiador por cada solicitud
 * pendiente. Es idempotente: una orden ya pagada se salta.
 *
 * Conviene dejarlo en el cron del hosting cada 15-30 minutos.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Order = require('../models/Order');
const addiService = require('../services/addiService');
const sistecreditoService = require('../services/sistecreditoService');
const { markOrderAsPaid } = require('../utils/orderFulfillment');

const PROVIDERS = { ADDI: addiService, SISTECREDITO: sistecreditoService };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Acepta "--dias 30" y "--dias=30". Cualquier valor no numerico cae al defecto,
// para no acabar filtrando por una fecha invalida.
const leerDias = () => {
    const conIgual = args.find((a) => a.startsWith('--dias='));
    if (conIgual) return Number(conIgual.split('=')[1]);

    const i = args.indexOf('--dias');
    if (i !== -1 && args[i + 1]) return Number(args[i + 1]);

    return NaN;
};

const diasLeidos = leerDias();
const dias = Number.isFinite(diasLeidos) && diasLeidos > 0 ? diasLeidos : 30;

const pesos = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;

/**
 * Identificador utilizable para consultar el estado.
 *
 * Las órdenes creadas antes de arreglar la extracción guardaron el orderId como
 * applicationId, que Addi no reconoce. El identificador real está dentro de la
 * redirectUrl, así que se recupera de ahí.
 */
const resolverApplicationId = (order) => {
    const app = order.creditApplication || {};
    const guardado = String(app.applicationId || '');
    const orderId = order._id.toString();

    // Si el guardado no es el orderId, se asume bueno.
    if (guardado && guardado !== orderId) return { id: guardado, reparado: false };

    const enUrl = String(app.redirectUrl || '').match(UUID_RE);
    if (enUrl) return { id: enUrl[0], reparado: true };

    return { id: guardado || orderId, reparado: false };
};

(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    const pendientes = await Order.find({
        isPaid: false,
        'creditApplication.provider': { $exists: true },
        'creditApplication.status': { $in: ['PENDING', 'CREATED', null] },
        createdAt: { $gte: desde },
    }).sort({ createdAt: -1 });

    console.log(`\n══ Conciliación de créditos ══`);
    console.log(`   Últimos ${dias} días · ${pendientes.length} orden(es) pendiente(s)`);
    if (dryRun) console.log(`   MODO SIMULACIÓN: no se modifica nada\n`);
    else console.log('');

    const resumen = { aprobadas: 0, rechazadas: 0, siguenPendientes: 0, errores: 0, reparadas: 0 };

    for (const order of pendientes) {
        const app = order.creditApplication;
        const service = PROVIDERS[app.provider];
        const etiqueta = `${order._id} · ${app.provider} · ${pesos(order.totalPrice)}`;

        if (!service) {
            console.log(`  ?  ${etiqueta} — proveedor desconocido`);
            resumen.errores += 1;
            continue;
        }

        if (!service.isConfigured()) {
            console.log(`  !  ${etiqueta} — ${app.provider} no está configurado en este .env`);
            resumen.errores += 1;
            continue;
        }

        const { id, reparado } = resolverApplicationId(order);
        if (reparado) {
            console.log(`  ~  ${etiqueta}`);
            console.log(`     identificador recuperado de la URL: ${id}`);
            resumen.reparadas += 1;
        }

        try {
            const result = await service.getApplicationStatus(id, { orderId: order._id.toString() });

            if (result.status === 'APPROVED') {
                console.log(`  ✓  ${etiqueta} — APROBADA por ${app.provider}`);
                console.log(`     cliente: ${order.shippingAddress?.fullName || '?'} · ${order.shippingAddress?.email || 'sin correo'}`);

                if (dryRun) {
                    console.log(`     (simulación: se confirmaría, se enviaría correo y se reportaría al Panel)`);
                } else {
                    order.creditApplication.applicationId = id;
                    order.creditApplication.status = result.status;
                    order.creditApplication.rawStatus = result.rawStatus;
                    order.creditApplication.updatedAt = new Date();
                    await order.save();

                    await markOrderAsPaid(order, {
                        method: app.provider,
                        transactionId: result.transactionId,
                        rawStatus: result.rawStatus,
                        customerEmail: order.shippingAddress?.email,
                    });
                    console.log(`     confirmada: stock descontado, correo enviado y venta reportada al Panel`);
                }
                resumen.aprobadas += 1;
            } else if (['REJECTED', 'CANCELLED', 'EXPIRED'].includes(result.status)) {
                console.log(`  ✗  ${etiqueta} — ${result.status} (${result.rawStatus})`);
                if (!dryRun) {
                    order.creditApplication.applicationId = id;
                    order.creditApplication.status = result.status;
                    order.creditApplication.rawStatus = result.rawStatus;
                    order.creditApplication.updatedAt = new Date();
                    order.status = 'Cancelled';
                    await order.save();
                }
                resumen.rechazadas += 1;
            } else {
                console.log(`  ·  ${etiqueta} — sigue ${result.status} (${result.rawStatus})`);
                if (!dryRun && reparado) {
                    order.creditApplication.applicationId = id;
                    await order.save();
                }
                resumen.siguenPendientes += 1;
            }
        } catch (err) {
            const status = err.response?.status;
            console.log(`  !  ${etiqueta} — error consultando: ${err.message}${status ? ` (HTTP ${status})` : ''}`);
            if (status === 404) {
                console.log(`     Addi no reconoce el identificador "${id}".`);
            }
            resumen.errores += 1;
        }
    }

    console.log(`\n── Resumen ──`);
    console.log(`   Aprobadas y confirmadas : ${resumen.aprobadas}`);
    console.log(`   Rechazadas o vencidas   : ${resumen.rechazadas}`);
    console.log(`   Siguen pendientes       : ${resumen.siguenPendientes}`);
    console.log(`   Identificadores repar.  : ${resumen.reparadas}`);
    console.log(`   Errores                 : ${resumen.errores}\n`);

    await mongoose.disconnect();
    process.exit(resumen.errores > 0 ? 1 : 0);
})().catch(async (err) => {
    console.error('Error fatal:', err.message);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
});
