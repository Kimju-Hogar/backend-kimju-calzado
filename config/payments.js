/**
 * Catálogo canónico de medios de pago.
 *
 * Este archivo es la ÚNICA fuente de verdad sobre cómo se llama cada medio de
 * pago en el sistema. Se usa para:
 *   - validar el `paymentMethod` que llega desde el checkout,
 *   - decidir qué botones se habilitan en el frontend,
 *   - y sobre todo, con qué nombre se reporta la venta al Panel de Contabilidad.
 *
 * Si mañana entra un nuevo financiador, se agrega aquí y aparece solo en toda
 * la aplicación (tienda + panel).
 */

const PAYMENT_METHODS = {
    WOMPI: {
        code: 'WOMPI',
        label: 'Wompi',
        // Nombre exacto con el que la venta queda registrada en el Panel.
        reportLabel: 'Wompi',
        kind: 'gateway',
        description: 'Tarjeta, PSE, Nequi y Bancolombia',
    },
    ADDI: {
        code: 'ADDI',
        label: 'Addi',
        reportLabel: 'Addi',
        kind: 'installments',
        description: 'Paga a cuotas sin tarjeta de crédito',
    },
    SISTECREDITO: {
        code: 'SISTECREDITO',
        label: 'Sistecrédito',
        reportLabel: 'Sistecrédito',
        kind: 'installments',
        description: 'Crédito a cuotas con tu cédula',
    },
    MANUAL: {
        code: 'MANUAL',
        label: 'Pago manual',
        reportLabel: 'Pago manual',
        kind: 'manual',
        description: 'Registrado manualmente por un administrador',
    },
};

const PAYMENT_METHOD_CODES = Object.keys(PAYMENT_METHODS);

/** Códigos que corresponden a financiación a cuotas. */
const INSTALLMENT_METHOD_CODES = PAYMENT_METHOD_CODES.filter(
    (code) => PAYMENT_METHODS[code].kind === 'installments'
);

/**
 * Normaliza cualquier variante que llegue ('addi', 'Addi', 'SISTECREDITO',
 * 'sistecrédito'...) al código canónico. Devuelve null si no se reconoce.
 */
const normalizePaymentMethod = (value) => {
    if (!value) return null;
    const cleaned = String(value)
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''); // quita tildes: SISTECRÉDITO -> SISTECREDITO
    return PAYMENT_METHOD_CODES.includes(cleaned) ? cleaned : null;
};

/** Etiqueta con la que la venta debe viajar al Panel de Contabilidad. */
const getReportLabel = (code) => {
    const normalized = normalizePaymentMethod(code);
    return normalized ? PAYMENT_METHODS[normalized].reportLabel : 'Otros';
};

/**
 * Recargo que se suma al precio cuando el cliente paga con este medio.
 *
 * Se lee del entorno (ADDI_SURCHARGE_PERCENT, SISTECREDITO_SURCHARGE_PERCENT)
 * y por defecto es 0: ningun medio recarga nada salvo que se configure.
 */
const surchargePercent = (code) => {
    const normalized = normalizePaymentMethod(code);
    if (!normalized) return 0;
    const value = Number(process.env[`${normalized}_SURCHARGE_PERCENT`]);
    return Number.isFinite(value) && value > 0 ? value : 0;
};

/**
 * Aplica el recargo sobre un importe base.
 *
 * Ojo con la aritmetica: sumar un 9% NO compensa una comision del 9%, porque la
 * comision se calcula sobre el total ya recargado. Con base 100 -> total 109 ->
 * comision 9,81 -> quedan 99,19. Para recibir exactamente el precio base hace
 * falta 100/(1-0,09) = +9,89%. El porcentaje es configurable justo por esto.
 */
const applySurcharge = (baseAmount, code) => {
    const base = Math.max(0, Math.round(Number(baseAmount) || 0));
    const percentage = surchargePercent(code);

    if (percentage <= 0) {
        return { base, percentage: 0, amount: 0, total: base };
    }

    const amount = Math.round((base * percentage) / 100);
    return { base, percentage, amount, total: base + amount };
};

module.exports = {
    surchargePercent,
    applySurcharge,
    PAYMENT_METHODS,
    PAYMENT_METHOD_CODES,
    INSTALLMENT_METHOD_CODES,
    normalizePaymentMethod,
    getReportLabel,
};
