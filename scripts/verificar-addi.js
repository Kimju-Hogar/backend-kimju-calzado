/**
 * Comprobación previa de la integración con Addi.
 *
 *   node scripts/verificar-addi.js
 *
 * Se ejecuta EN EL SERVIDOR, con el .env real, antes de anunciar Addi a los
 * clientes. Revisa la configuración y hace una llamada de autenticación de
 * verdad contra Addi.
 *
 * NO crea ninguna solicitud de crédito: solo pide un token y lo descarta. Es
 * seguro correrlo en producción las veces que haga falta.
 *
 * Existe porque el resto del módulo se escribió contra el contrato público de
 * Addi, sin haber podido probarlo nunca con credenciales reales. Este script es
 * la forma de confirmar que ese contrato coincide con el convenio de la tienda
 * antes de que un cliente se lo encuentre en el checkout.
 */

require('dotenv').config();

const addi = require('../services/addiService');

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);
const info = (m) => console.log(`    ${m}`);
const title = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

const clean = (v) => String(v || '').replace(/["']/g, '').replace(/\/+$/, '');

let problemas = 0;
let avisos = 0;

(async () => {
    console.log('\n══ Comprobación de Addi ══');

    const cfg = addi.config();

    // ── 1. Variables ────────────────────────────────────────────────────────
    title('1. Configuración');

    if (!cfg.enabled) {
        bad('ADDI_ENABLED no está en true. Addi no se ofrece en el checkout.');
        problemas += 1;
    } else {
        ok('ADDI_ENABLED=true');
    }

    for (const [name, value] of [
        ['ADDI_CLIENT_ID', cfg.clientId],
        ['ADDI_CLIENT_SECRET', cfg.clientSecret],
    ]) {
        if (!value) {
            bad(`${name} está vacío. Pégalo en el .env.`);
            problemas += 1;
        } else {
            ok(`${name} presente (${value.length} caracteres, termina en …${value.slice(-4)})`);
        }
    }

    // ── 2. Ambiente ─────────────────────────────────────────────────────────
    title('2. Ambiente');

    const esStaging = [cfg.authUrl, cfg.audience, cfg.apiUrl].map((u) => /addi-staging/.test(u));
    const todosStaging = esStaging.every(Boolean);
    const ningunoStaging = esStaging.every((v) => !v);

    info(`auth     ${cfg.authUrl}`);
    info(`audience ${cfg.audience}`);
    info(`api      ${cfg.apiUrl}`);

    if (todosStaging) {
        ok('Apuntando a PRUEBAS (addi-staging.com) de forma consistente.');
        warn('Requiere credenciales de pruebas. Las de producción fallarán aquí.');
        avisos += 1;
    } else if (ningunoStaging) {
        ok('Apuntando a PRODUCCIÓN (addi.com) de forma consistente.');
        warn('Requiere credenciales de producción. Las de pruebas fallarán aquí.');
        avisos += 1;
    } else {
        bad('Las tres URLs están MEZCLADAS entre pruebas y producción. Deben ser del mismo ambiente.');
        problemas += 1;
    }

    // ── 3. URLs públicas ────────────────────────────────────────────────────
    title('3. URLs que Addi va a usar');

    const frontend = clean(process.env.FRONTEND_URL);
    const backend = clean(process.env.API_URL || process.env.BACKEND_URL);

    for (const [label, url] of [['FRONTEND_URL', frontend], ['API_URL', backend]]) {
        if (!url) {
            bad(`${label} está vacío.`);
            problemas += 1;
        } else if (/localhost|127\.0\.0\.1/.test(url)) {
            bad(`${label} apunta a ${url} — Addi no puede alcanzar una dirección local.`);
            problemas += 1;
        } else if (!/^https:\/\//.test(url)) {
            bad(`${label} no usa https: ${url}`);
            problemas += 1;
        } else {
            ok(`${label} = ${url}`);
        }
    }

    if (frontend && backend) {
        console.log('\n  Registra estas dos en el portal de Addi:');
        info(`webhook   ${backend}/api/payments/credit/addi/webhook`);
        info(`retorno   ${frontend}/order/{orderId}/credit-result`);
    }

    // ── 4. Montos ───────────────────────────────────────────────────────────
    title('4. Rango de compra');
    info(`mínimo ${cfg.minAmount.toLocaleString('es-CO')}  ·  máximo ${cfg.maxAmount.toLocaleString('es-CO')}`);
    if (cfg.minAmount >= cfg.maxAmount) {
        bad('El mínimo es mayor o igual que el máximo: Addi nunca se ofrecería.');
        problemas += 1;
    } else {
        ok('Rango coherente.');
    }
    warn('Confirma estas dos cifras contra tu convenio: por fuera del rango la tienda no ofrece Addi.');
    avisos += 1;

    // ── 5. Llamada real ─────────────────────────────────────────────────────
    title('5. Autenticación contra Addi');

    if (!cfg.clientId || !cfg.clientSecret) {
        warn('Omitida: faltan credenciales.');
        avisos += 1;
    } else {
        try {
            const inicio = Date.now();
            const token = await addi.__getAccessTokenForCheck();
            ok(`Addi respondió con un token en ${Date.now() - inicio} ms.`);
            info(`El token empieza por ${String(token).slice(0, 12)}…`);
            ok('Las credenciales y el ambiente coinciden.');
        } catch (err) {
            const status = err.response?.status;
            const cuerpo = err.response?.data;

            bad(`Falló la autenticación${status ? ` (HTTP ${status})` : ''}: ${err.message}`);
            problemas += 1;

            if (status === 401 || status === 403) {
                info('Causa habitual: credenciales de un ambiente contra URLs del otro,');
                info('o client_secret mal copiado.');
            } else if (status === 404) {
                info('La ADDI_AUTH_URL no existe. Confírmala con Addi.');
            } else if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
                info('El servidor no logró salir a internet hacia Addi.');
                info('Revisa DNS o el cortafuegos de salida del hosting.');
            }
            if (cuerpo) info(`Respuesta: ${JSON.stringify(cuerpo).slice(0, 300)}`);
        }
    }

    // ── 6. El host del API responde JSON? ───────────────────────────────────
    title('6. El API responde JSON, no una pagina web');

    // Comprobacion aprendida a las malas: con ADDI_API_URL=https://api.addi.com
    // la peticion devolvia 200 con el HTML de un sitio Next.js, y el error
    // resultante parecia un problema del payload.
    try {
        const axios = require('axios');
        const url = `${cfg.apiUrl}${cfg.createPath}`;
        const r = await axios.post(url, {}, {
            timeout: 15000,
            validateStatus: () => true,
            headers: { 'Content-Type': 'application/json' },
        });

        const cuerpo = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        const esWeb = /^\s*(<!DOCTYPE|<html)/i.test(cuerpo);

        info(`POST ${url} -> HTTP ${r.status}`);

        if (esWeb) {
            bad('Devolvio una PAGINA WEB, no JSON. Esta URL no es el API de Addi.');
            info('Corrige ADDI_API_URL y/o ADDI_CREATE_PATH con lo que diga el manual.');
            info(`Recibido: ${cuerpo.slice(0, 90)}...`);
            problemas += 1;
        } else if (r.status === 401 || r.status === 403) {
            ok('Responde JSON y pide autenticacion: es un endpoint de API real.');
        } else if (r.status >= 400 && r.status < 500) {
            ok('Responde JSON con un error de validacion: el endpoint existe.');
            info(`Respuesta: ${cuerpo.slice(0, 200)}`);
        } else {
            warn(`Respuesta inesperada (HTTP ${r.status}): ${cuerpo.slice(0, 200)}`);
            avisos += 1;
        }
    } catch (err) {
        bad(`No se pudo consultar el endpoint: ${err.message}`);
        problemas += 1;
    }

    // ── Resumen ─────────────────────────────────────────────────────────────
    title('Resumen');

    if (problemas === 0 && avisos === 0) {
        ok('Todo en orden.');
    } else {
        if (problemas > 0) bad(`${problemas} problema(s) que impiden que Addi funcione.`);
        if (avisos > 0) warn(`${avisos} punto(s) por confirmar con Addi.`);
    }

    console.log(`
  Esto valida configuración y credenciales, no el flujo completo.
  Falta una compra de prueba real: elegir Addi en el checkout, completar la
  solicitud en el sitio de Addi y comprobar que la orden queda pagada y que la
  venta llega al Panel como "Addi".
`);

    process.exit(problemas > 0 ? 1 : 0);
})();
