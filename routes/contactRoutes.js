const express = require('express');
const router = express.Router();
const { sendEmail, getTemplate } = require('../utils/emailService');

router.post('/', async (req, res) => {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ msg: 'Por favor llena todos los campos' });
    }

    try {
        const adminEmail = process.env.EMAIL_USER; // Send to admin
        const subject = `Nuevo mensaje de contacto de ${name} 🌸`;

        const content = `
            <strong>Nombre:</strong> ${name}<br>
            <strong>Email:</strong> ${email}<br><br>
            <strong>Mensaje:</strong><br>
            <div style="background-color: #fff5f9; padding: 15px; border-radius: 10px; border: 1px dashed #fbcfe8; color: #db2777; font-style: italic;">
                "${message}"
            </div>
        `;

        const html = getTemplate('Nuevo Mensaje de Contacto 💌', content);

        await sendEmail({ email: adminEmail, subject, html });

        res.json({ msg: 'Mensaje enviado correctamente. Te responderemos pronto. 💖' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error enviando mensaje');
    }
});

module.exports = router;
