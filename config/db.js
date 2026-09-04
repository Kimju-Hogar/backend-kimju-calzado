/**
 * Conexión a MongoDB reutilizable entre invocaciones.
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * El código anterior hacía `mongoose.connect()` al cargar el módulo y no
 * esperaba el resultado. En un servidor tradicional eso funciona: el proceso
 * arranca, conecta, y para cuando llega la primera petición ya está lista.
 *
 * En serverless no. Cada arranque en frío ejecuta el módulo y atiende la
 * petición de inmediato, sin esperar. Mongoose encola la consulta y a los 10
 * segundos la aborta:
 *
 *   Operation `products.find()` buffering timed out after 10000ms
 *
 * De ahí que unas peticiones dieran 200 (instancia caliente) y otras 500
 * (instancia fría), aparentemente al azar.
 *
 * Aquí se hace lo contrario: se guarda la PROMESA de conexión en una variable
 * global —lo único que sobrevive entre invocaciones de una misma instancia— y
 * cada petición la espera antes de tocar la base. Si dos peticiones llegan a la
 * vez durante un arranque en frío, ambas esperan la misma promesa en lugar de
 * abrir dos conexiones.
 *
 * Sin esto, cada arranque en frío abría una conexión nueva que nadie cerraba, y
 * con suficiente tráfico se agota el límite de conexiones de Atlas.
 */

const mongoose = require('mongoose');

// `global` persiste mientras la instancia siga viva. En un servidor normal es
// para siempre; en serverless, lo que dure la instancia.
let cache = global.__kimjuMongo;
if (!cache) {
    cache = global.__kimjuMongo = { conn: null, promise: null };
}

const connectDB = async () => {
    if (cache.conn) return cache.conn;

    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI no está definida. Revisa la configuración del entorno.');
    }

    if (!cache.promise) {
        cache.promise = mongoose
            .connect(process.env.MONGO_URI, {
                // Sin buffering: si no hay conexión, la consulta falla al
                // instante con un error claro en vez de colgarse 10 segundos.
                bufferCommands: false,
                // Suficiente para varias peticiones simultáneas sin agotar el
                // limite de Atlas cuando hay muchas instancias vivas a la vez.
                maxPoolSize: 10,
                // Por debajo del limite de ejecucion de una funcion serverless,
                // para que el error se vea en vez de morir por timeout.
                serverSelectionTimeoutMS: 8000,
            })
            .then((m) => {
                console.log('[BD] Conectado a MongoDB');
                return m;
            })
            .catch((err) => {
                // Si falla, se descarta la promesa para que el siguiente intento
                // vuelva a probar en vez de quedarse con el fallo cacheado.
                cache.promise = null;
                throw err;
            });
    }

    cache.conn = await cache.promise;
    return cache.conn;
};

/**
 * Middleware que garantiza la conexión antes de atender una petición.
 * Es lo que faltaba: sin esto la consulta salía antes de haber conectado.
 */
const ensureDB = async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        console.error('[BD] No se pudo conectar:', error.message);
        res.status(503).json({
            message: 'Base de datos no disponible en este momento. Intenta de nuevo.',
        });
    }
};

module.exports = { connectDB, ensureDB };
