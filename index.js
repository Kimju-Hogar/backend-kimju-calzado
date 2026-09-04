const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Rutas explicitas en vez de dotenv.config() a secas.
//
// Sin ruta, dotenv busca en process.cwd(). Si el gestor de procesos arranca la
// app desde otro directorio, el .env queda invisible y el servidor muere sin
// configuracion. Con __dirname se carga siempre, se arranque desde donde se
// arranque.
//
// La segunda ruta es la carpeta donde Hostinger guarda las variables del panel:
// sobrevive a los despliegues, mientras que un .env dentro de la version actual
// se pierde en el siguiente.
const rutasEnv = [
    path.join(__dirname, '.env'),
    path.resolve(__dirname, '../../config/.env'),
];

let envCargado = false;
for (const ruta of rutasEnv) {
    if (!fs.existsSync(ruta)) continue;
    const r = dotenv.config({ path: ruta });
    if (!r.error) {
        console.log(`[Entorno] Configuracion leida de ${ruta}`);
        envCargado = true;
        break;
    }
}

// Sin archivo, las variables pueden venir inyectadas por el hosting.
if (!envCargado) {
    dotenv.config();
    console.log('[Entorno] Sin archivo .env; se usan las variables del sistema.');
}

// Comprueba la configuracion ANTES de intentar conectar a la base de datos.
// Sin esto, unas variables ausentes producian un error de Mongoose sin contexto
// y un bucle de reinicios que dejaba toda la API en 503.
const { verificarEntorno } = require('./config/verificarEntorno');
const { connectDB, ensureDB } = require('./config/db');
verificarEntorno();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
// Ninguna ruta de la API se atiende sin conexion lista. Esto es lo que
// faltaba: la consulta salia antes de que la base estuviera disponible.
app.use('/api', ensureDB);

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/sync', require('./routes/productSyncRoutes')); // Sync Routes
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/newsletter', require('./routes/newsletterRoutes'));
app.use('/api/contact', require('./routes/contactRoutes'));

// Upload Route for Images
const { uploadImage } = require('./controllers/imageController');
app.post('/api/upload', uploadImage);

// Serve static assets (images)
app.use('/uploads', express.static('uploads'));

// Basic Route
app.get('/', (req, res) => {
    res.send('Kimju Calzado API is running');
});

// ── Arranque ────────────────────────────────────────────────────────────────
//
// La conexion a la base la abre el middleware ensureDB en cada peticion, y se
// reutiliza mientras la instancia siga viva (ver config/db.js). Antes se
// lanzaba aqui sin esperarla, lo que en serverless provocaba
// "buffering timed out after 10000ms" en los arranques en frio.

// Solo se escucha un puerto cuando el archivo se ejecuta directamente. En una
// plataforma serverless el archivo se importa, no se ejecuta, y ahi lo que hace
// falta es exportar la app.
if (require.main === module) {
    connectDB()
        .then(() => {
            app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
        })
        .catch((err) => {
            console.error('[BD] No se pudo conectar al arrancar:', err.message);
            process.exit(1);
        });
}

module.exports = app;
