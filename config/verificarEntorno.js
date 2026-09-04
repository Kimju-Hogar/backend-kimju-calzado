/**
 * Comprobación del entorno antes de arrancar.
 *
 * POR QUÉ EXISTE
 *
 * Cuando las variables de entorno no llegaban al proceso, el servidor moría con
 * este error de Mongoose:
 *
 *   The `uri` parameter to `openUri()` must be a string, got "undefined"
 *
 * ...y el gestor de procesos lo reiniciaba en bucle. En el log solo se veían
 * decenas de líneas de dotenv repetidas, y la API respondía 503 en todas las
 * rutas. Nada apuntaba a la causa real: que faltaba la configuración.
 *
 * Esta comprobación convierte ese fallo silencioso en un mensaje que dice
 * exactamente qué falta y dónde ponerlo.
 */

const CRITICAS = [
    ['MONGO_URI', 'Cadena de conexión a MongoDB. Sin ella el servidor no arranca.'],
    ['JWT_SECRET', 'Firma de las sesiones. Sin ella nadie puede iniciar sesión.'],
];

const IMPORTANTES = [
    ['PRODUCT_TYPE', 'Separa el catálogo y el carrito de las dos tiendas ("hogar" / "calzado").'],
    ['STORE_NAME', 'Nombre con el que las ventas llegan al Panel de Contabilidad.'],
    ['FRONTEND_URL', 'A dónde vuelve el cliente desde Addi y qué enlaces llevan los correos.'],
    ['API_URL', 'Dónde nos notifica Addi.'],
    ['PANEL_API_URL', 'A dónde se reportan las ventas.'],
    ['EMAIL_USER', 'Remitente de los correos de confirmación.'],
];

/**
 * @param {object} opciones
 * @param {boolean} opciones.salirSiFalta  Terminar el proceso si falta una crítica.
 */
const verificarEntorno = ({ salirSiFalta = true } = {}) => {
    const vacia = (nombre) => !String(process.env[nombre] || '').trim();

    const faltanCriticas = CRITICAS.filter(([n]) => vacia(n));
    const faltanImportantes = IMPORTANTES.filter(([n]) => vacia(n));

    if (faltanCriticas.length === 0 && faltanImportantes.length === 0) {
        console.log(`[Entorno] Configuración completa (tienda: ${process.env.PRODUCT_TYPE}).`);
        return true;
    }

    console.error('\n' + '='.repeat(70));
    console.error('  CONFIGURACION INCOMPLETA');
    console.error('='.repeat(70));

    // Pista clave: distinguir "no hay variables" de "falta alguna".
    const totalVars = Object.keys(process.env).length;
    if (faltanCriticas.length === CRITICAS.length) {
        console.error('');
        console.error('  NO se cargo NINGUNA variable de configuracion.');
        console.error('');
        console.error('  Si estas en un hosting con panel de variables de entorno, revisa:');
        console.error('    1. Que las variables esten en la aplicacion correcta.');
        console.error('    2. Que se haya reiniciado la app DESPUES de guardarlas.');
        console.error('    3. Que exista un archivo .env en la raiz del backend.');
        console.error('');
        console.error(`  (el proceso ve ${totalVars} variables de entorno en total)`);
    }

    if (faltanCriticas.length > 0) {
        console.error('');
        console.error('  FALTAN (el servidor no puede arrancar):');
        faltanCriticas.forEach(([n, d]) => console.error(`    ${n.padEnd(18)} ${d}`));
    }

    if (faltanImportantes.length > 0) {
        console.error('');
        console.error('  FALTAN (arranca, pero algo no va a funcionar):');
        faltanImportantes.forEach(([n, d]) => console.error(`    ${n.padEnd(18)} ${d}`));
    }

    console.error('='.repeat(70) + '\n');

    if (faltanCriticas.length > 0 && salirSiFalta) {
        console.error('[Entorno] Arranque cancelado. Corrige lo de arriba y reinicia.\n');
        // Salir aqui evita el bucle de reinicios con un error de Mongoose que no
        // explica nada.
        process.exit(1);
    }

    return faltanCriticas.length === 0;
};

module.exports = { verificarEntorno };
