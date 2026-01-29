const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- Kawaii Template Generator ---
const getTemplate = (title, content, actionLink = null, actionText = null) => {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #fdf2f8; }
            .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 30px; overflow: hidden; box-shadow: 0 20px 40px rgba(236, 72, 153, 0.15); border: 4px solid #fce7f3; }
            .header { background: linear-gradient(135deg, #fbcfe8 0%, #f9a8d4 100%); padding: 50px 20px; text-align: center; position: relative; overflow: hidden; }
            .header::before { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle, rgba(255,255,255,0.2) 20%, transparent 20%); background-size: 20px 20px; opacity: 0.5; }
            .logo { font-size: 36px; font-weight: 900; color: #fff; letter-spacing: -1px; text-transform: uppercase;position: relative; text-shadow: 2px 2px 0px rgba(219, 39, 119, 0.3); }
            .logo span { color: #fdf2f8; font-weight: 300; }
            .content { padding: 50px 40px; text-align: center; color: #4b5563; background-image: radial-gradient(#fce7f3 1px, transparent 1px); background-size: 30px 30px; }
            .title { font-size: 28px; font-weight: 800; color: #db2777; margin-bottom: 20px; line-height: 1.2; }
            .text { font-size: 16px; line-height: 1.8; margin-bottom: 30px; color: #6b7280; font-weight: 500; }
            .items-box { background: #fff; border-radius: 20px; padding: 25px; text-align: left; margin-bottom: 30px; border: 2px dashed #fbcfe8; box-shadow: 5px 5px 0px #fce7f3; }
            .item-row { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 15px; color: #db2777; font-weight: 700; border-bottom: 1px solid #fce7f3; padding-bottom: 8px; }
            .item-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
            .total { font-size: 22px; font-weight: 900; color: #be185d; text-align: right; margin-top: 20px; }
            .btn { display: inline-block; background: #db2777; color: #ffffff; text-decoration: none; padding: 18px 40px; border-radius: 50px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-top: 25px; box-shadow: 0 10px 20px rgba(219, 39, 119, 0.25); transition: transform 0.2s; }
            .btn:hover { transform: translateY(-3px); box-shadow: 0 15px 30px rgba(219, 39, 119, 0.35); }
            .footer { background: #fdf4f9; padding: 40px; text-align: center; font-size: 13px; color: #9ca3af; font-weight: 600; border-top: 1px solid #fce7f3; }
            .footer-links { margin-bottom: 20px; }
            .footer-links a { color: #db2777; text-decoration: none; margin: 0 10px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Kimju<span>Hogar</span> 🌸</div>
            </div>
            <div class="content">
                <div class="title">${title}</div>
                <div class="text">${content}</div>
                ${actionLink ? `<a href="${actionLink}" class="btn">${actionText}</a>` : ''}
            </div>
            <div class="footer">
                <div class="footer-links">
                    <a href="https://kimjuhogar.com/shop">Tienda</a> •
                    <a href="https://kimjuhogar.com/profile">Mi Cuenta</a> •
                    <a href="https://kimjuhogar.com/contact">Ayuda</a>
                </div>
                <p>Hecho con 💖 para tu hogar.</p>
                <p>&copy; ${new Date().getFullYear()} Kimju Hogar. Valledupar, Colombia.</p>
            </div>
        </div>
    </body>
    </html>
    `;
};

const sendOrderEmail = async (order, user) => {
    try {
        if (!user || !user.email) {
            console.warn(`[EMAIL WARNING] Skipping order email for order ${order._id}: No recipient email defined.`);
            return false;
        }
        console.log(`[EMAIL] Sending Order to ${user.email}`);

        const itemsHtml = `
            <div class="items-box">
                ${order.orderItems.map(item => `
                    <div class="item-row" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #fce7f3; padding-bottom: 10px; margin-bottom: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                             ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid #fce7f3;">` : ''}
                             <div style="text-align: left;">
                                 <div style="font-size: 14px; font-weight: 700; color: #db2777;">${item.name}</div>
                                 <div style="font-size: 12px; color: #9ca3af;">
                                     Qty: ${item.quantity} 
                                     ${item.selectedVariation ? `• <span style="background: #fdf2f8; padding: 2px 6px; border-radius: 4px; color: #be185d; font-weight: 600;">${item.selectedVariation}</span>` : ''}
                                 </div>
                             </div>
                        </div>
                        <span style="font-weight: 800; color: #db2777;">$${item.price.toLocaleString()}</span>
                    </div>
                `).join('')}
                <div class="total">Total: $${order.totalPrice.toLocaleString()}</div>
            </div>
        `;

        const htmlContent = getTemplate(
            `¡Gracias por tu compra, ${(user.name || 'Cliente').split(' ')[0]}! 💖`,
            `Estamos preparando tu pedido #${order._id} con mucho cuidado y cariño. Aquí tienes un resumen de tus cositas maravillosas:<br/><br/>${itemsHtml}`,
            'https://kimjuhogar.com/profile', // Link to view order
            'Ver mi Pedido'
        );

        const mailOptions = {
            from: '"Kimju Hogar" <no-reply@kimjuhogar.com>',
            to: user.email,
            subject: `¡Tu pedido #${order._id} está confirmado! 🌸`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Email handling error:', error);
        return false;
    }
};

const sendAdminNewOrderEmail = async (order, user) => {
    try {
        const adminEmail = 'kimjuhogar@gmail.com';
        console.log(`[EMAIL] Sending Admin Notification to ${adminEmail}`);

        const itemsHtml = `
            <div class="items-box">
                ${order.orderItems.map(item => `
                    <div class="item-row" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #fce7f3; padding-bottom: 10px; margin-bottom: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                             ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid #fce7f3;">` : ''}
                             <div style="text-align: left;">
                                 <div style="font-size: 14px; font-weight: 700; color: #db2777;">${item.name}</div>
                                 <div style="font-size: 12px; color: #9ca3af;">
                                     Qty: ${item.quantity} 
                                     ${item.selectedVariation ? `• <span style="background: #fdf2f8; padding: 2px 6px; border-radius: 4px; color: #be185d; font-weight: 600;">${item.selectedVariation}</span>` : ''}
                                 </div>
                             </div>
                        </div>
                        <span style="font-weight: 800; color: #db2777;">$${item.price.toLocaleString()}</span>
                    </div>
                `).join('')}
                <div class="total">Total: $${order.totalPrice.toLocaleString()}</div>
            </div>
        `;

        const customerInfoHtml = `
            <div style="background-color: #fdf2f8; padding: 15px; border-radius: 10px; margin-bottom: 20px; text-align: left; font-size: 14px; color: #4b5563;">
                 <strong style="color: #db2777;">Datos del Cliente:</strong><br/>
                 👤 <strong>Nombre:</strong> ${user.name}<br/>
                 📧 <strong>Email:</strong> ${user.email}<br/>
                 📞 <strong>Teléfono:</strong> ${order.shippingAddress.phone || user.phone || 'N/A'}<br/>
                 📍 <strong>Dirección:</strong> ${order.shippingAddress.address}, ${order.shippingAddress.city}, ${order.shippingAddress.state}<br/>
                 🆔 <strong>ID/CC:</strong> ${order.shippingAddress.legalId || 'N/A'}
            </div>
        `;

        const htmlContent = getTemplate(
            '¡Nueva Venta Realizada! 🎉',
            `¡Felicidades! Se ha realizado una nueva compra en Kimju Hogar.<br/><br/>
            ${customerInfoHtml}
            <strong>Detalle del Pedido #${order._id}:</strong><br/>
            ${itemsHtml}`,
            `https://kimjuhogar.com/admin`,
            'Ir al Panel Admin'
        );

        const mailOptions = {
            from: '"Kimju Bot 🤖" <no-reply@kimjuhogar.com>',
            to: adminEmail,
            subject: `¡Nueva Venta! 🤑 Orden #${order._id} - $${order.totalPrice.toLocaleString()}`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Admin Email error:', error);
        return false;
    }
};

const sendTrackingEmail = async (order, trackingNumber) => {
    try {
        // Populate user if needed, or assume order.shippingAddress has email if user is null (guest)
        // Ideally order should be populated with user before calling this, or assume order.user is the object.
        const recipientEmail = order.user?.email || order.shippingAddress.email;
        const recipientName = order.user?.name || order.shippingAddress.fullName || 'Cliente';

        if (!recipientEmail) {
            console.warn(`[EMAIL WARNING] No recipient for tracking email.`);
            return false;
        }

        console.log(`[EMAIL] Sending Tracking Info to ${recipientEmail}`);

        const htmlContent = getTemplate(
            '¡Tu pedido está en camino! 🚚',
            `Hola ${recipientName.split(' ')[0]},<br/><br/>
            ¡Buenas noticias! Hemos enviado tu pedido <strong>#${order._id}</strong>.<br/><br/>
            Tu número de guía es: <strong style="font-size: 18px; color: #db2777; background: #fce7f3; padding: 5px 10px; border-radius: 5px;">${trackingNumber}</strong><br/><br/>
            Puedes rastrear tu paquete usando este número en la transportadora correspondiente.`,
            'https://kimjuhogar.com/profile',
            'Ver mi Pedido'
        );

        const mailOptions = {
            from: '"Kimju Hogar" <no-reply@kimjuhogar.com>',
            to: recipientEmail,
            subject: `🚚 ¡Tu pedido #${order._id} ha sido enviado!`,
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Tracking Email error:', error);
        return false;
    }
};


const sendRecoveryEmail = async (user, token) => {
    try {
        console.log(`[EMAIL] Sending Recovery to ${user.email}`);

        // Link to Frontend Reset Page
        const resetUrl = `${process.env.BASE_URL}/reset-password/${token}`;

        const htmlContent = getTemplate(
            'Restablecer Contraseña 🔐',
            `Hola ${(user.name || 'Usuario').split(' ')[0]}, hemos recibido una solicitud para cambiar tu contraseña. Si no fuiste tú, ignora este mensaje.<br/><br/>Para crear una nueva contraseña, haz clic en el siguiente botón:`,
            resetUrl,
            'Restablecer Contraseña'
        );

        const mailOptions = {
            from: '"Kimju Hogar" <no-reply@kimjuhogar.com>',
            to: user.email,
            subject: 'Recuperación de Contraseña - Kimju Hogar',
            html: htmlContent
        };

        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Email handling error:', error);
        return false;
    }
};

const sendEmail = async ({ email, subject, html }) => {
    try {
        const mailOptions = {
            from: '"Kimju Hogar" <no-reply@kimjuhogar.com>',
            to: email,
            subject: subject,
            html: html
        };

        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Sent to ${email}`);
        return true;
    } catch (error) {
        console.error('Email handling error:', error);
        throw error; // Re-throw to handle in controller
    }
};

module.exports = { sendOrderEmail, sendRecoveryEmail, sendEmail, sendAdminNewOrderEmail, sendTrackingEmail, getTemplate };
