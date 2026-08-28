const express = require('express');
const router = express.Router();

/**
 * Suscripcion al boletin: RETIRADA.
 *
 * Esta ruta aceptaba cualquier direccion de correo sin validar el formato, sin
 * limite de peticiones y sin autenticacion, y la pasaba tal cual al campo "to"
 * de nodemailer. Es decir, cualquiera en internet podia hacer que la cuenta de
 * correo de la tienda escribiera a terceros.
 *
 * Se responde 410 (Gone) en vez de borrar el archivo para que quede constancia
 * de por que no existe, y para que cualquier bot que la siga golpeando reciba
 * una respuesta definitiva.
 *
 * Los suscriptores ya registrados siguen intactos en la coleccion "newsletters".
 *
 * Si se quiere reactivar, hace falta antes: validar el formato del correo,
 * limitar peticiones por IP, y confirmar la suscripcion por doble opt-in (no
 * enviar nada hasta que la persona confirme desde su propio buzon).
 */
router.all('/', (req, res) => {
    console.warn(`[Newsletter] Intento de uso de la ruta retirada desde ${req.ip}`);
    res.status(410).json({ msg: 'La suscripcion al boletin no esta disponible.' });
});

module.exports = router;
