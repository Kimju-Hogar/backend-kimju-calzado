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

module.exports = {
    PAYMENT_METHODS,
    PAYMENT_METHOD_CODES,
    INSTALLMENT_METHOD_CODES,
    normalizePaymentMethod,
    getReportLabel,
};
