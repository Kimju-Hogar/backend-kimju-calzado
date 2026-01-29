const Newsletter = require('../models/Newsletter');
const { sendEmail, getTemplate } = require('../utils/emailService');

// @desc    Subscribe to newsletter
// @route   POST /api/newsletter
exports.subscribeCallback = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ msg: 'Por favor ingresa un correo electrónico válido.' });
    }

    try {
        // Check if already subscribed
        let subscriber = await Newsletter.findOne({ email });

        if (subscriber) {
            return res.status(400).json({ msg: '¡Ya formas parte del Club Kimju Shoes! 👟✨' });
        }

        subscriber = new Newsletter({ email });
        await subscriber.save();

        // Send Welcome Email
        const emailSubject = '¡Bienvenido al Club Kimju Shoes! 👟🔥';

        const welcomeContent = `
            ¡Hola! 👋<br><br>
            Gracias por unirte al <strong>Club Kimju Shoes</strong>.  
            A partir de ahora serás el primero en enterarte de:
            <ul style="color: #111827; font-weight: bold; list-style-type: none; padding: 10px 0;">
                <li style="margin-bottom: 10px;">👟 Nuevos lanzamientos y colecciones</li>
                <li style="margin-bottom: 10px;">🔥 Descuentos exclusivos para miembros</li>
                <li style="margin-bottom: 10px;">✨ Tendencias y tips de estilo</li>
            </ul>
            Prepárate para caminar con actitud y estilo.<br><br>
            ¡Gracias por confiar en Kimju!
        `;

        const emailHtml = getTemplate(
            'Bienvenido al Club Kimju Shoes 👟',
            welcomeContent,
            process.env.FRONTEND_URL || 'http://localhost:5173',
            'Ver la Colección'
        );

        try {
            await sendEmail({
                email: subscriber.email,
                subject: emailSubject,
                html: emailHtml
            });
        } catch (emailErr) {
            console.error('Newsletter email failed', emailErr);
            // No fallar la suscripción si el email falla
        }

        res.status(201).json({ msg: '¡Suscripción exitosa! Revisa tu correo 👟💌' });

    } catch (err) {
        console.error(err);
        if (err.code === 11000) {
            return res.status(400).json({ msg: 'Este correo ya está registrado.' });
        }
        res.status(500).send('Server Error');
    }
};
