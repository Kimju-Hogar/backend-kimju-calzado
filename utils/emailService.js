const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// --- Cyber-Luxe Template Generator ---
const getTemplate = (title, content, actionLink = null, actionText = null) => {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #0B1121; color: #ffffff; }
            .container { max-width: 600px; margin: 40px auto; background: #151e32; border-radius: 20px; overflow: hidden; box-shadow: 0 0 50px rgba(236, 72, 153, 0.1); border: 1px solid rgba(255,255,255,0.1); }
            .header { background: #050505; padding: 40px 20px; text-align: center; border-bottom: 2px solid #EC4899; }
            .logo { font-size: 28px; font-weight: 900; color: #ffffff; letter-spacing: 2px; text-transform: uppercase; }
            .logo span { color: #EC4899; }
            .content { padding: 40px; text-align: center; color: #cbd5e1; }
            .title { font-size: 24px; font-weight: 800; color: #EC4899; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
            .text { font-size: 15px; line-height: 1.6; margin-bottom: 30px; color: #94a3b8; }
            .items-box { background: rgba(0,0,0,0.2); border-radius: 15px; padding: 20px; text-align: left; margin-bottom: 30px; border: 1px solid rgba(255,255,255,0.05); }
            .item-row { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 14px; color: #fff; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px; }
            .item-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
            .total { font-size: 20px; font-weight: 900; color: #EC4899; text-align: right; margin-top: 20px; text-transform: uppercase; letter-spacing: 1px; }
            .btn { display: inline-block; background: #EC4899; color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 50px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; margin-top: 20px; font-size: 12px; box-shadow: 0 0 20px rgba(236, 72, 153, 0.4); }
            .btn:hover { background: #db2777; box-shadow: 0 0 30px rgba(236, 72, 153, 0.6); }
            .footer { background: #0f172a; padding: 40px; text-align: center; font-size: 11px; color: #64748b; font-weight: 600; border-top: 1px solid rgba(255,255,255,0.05); text-transform: uppercase; letter-spacing: 1px; }
            .footer-links a { color: #EC4899; text-decoration: none; margin: 0 10px; }
            .data-box { background: rgba(236, 72, 153, 0.05); padding: 20px; border-radius: 10px; border: 1px solid rgba(236, 72, 153, 0.1); margin-bottom: 20px; text-align: left; font-size: 13px; color: #cbd5e1; }
            .data-box strong { color: #EC4899; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">KIMJU<span>CALZADO</span></div>
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
                <p>Estilo y elegancia para tu hogar.</p>
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
                    <div class="item-row" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px; margin-bottom: 10px;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                             ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);">` : ''}
                             <div style="text-align: left;">
                                 <div style="font-size: 13px; font-weight: 700; color: #fff; text-transform: uppercase;">${item.name}</div>
                                 <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;">
                                     CANT: ${item.quantity} 
                                     ${item.selectedVariation ? `• <span style="color: #EC4899;">${item.selectedVariation}</span>` : ''}
                                 </div>
                             </div>
                        </div>
                        <span style="font-weight: 700; color: #EC4899;">$${item.price.toLocaleString()}</span>
                    </div>
                `).join('')}
                <div class="total">Total: $${order.totalPrice.toLocaleString()}</div>
            </div>
        `;

        const htmlContent = getTemplate(
            `¡PEDIDO CONFIRMADO!`,
            `Hola <strong>${(user.name || 'Cliente').split(' ')[0]}</strong>,<br/><br/>
            Tu pedido <strong>#${order._id}</strong> ha sido recibido exitosamente. Estamos preparándolo para envío.<br/><br/>${itemsHtml}`,
            'https://kimjuhogar.com/profile', // Link to view order
            'VER MI PEDIDO'
        );

        const mailOptions = {
            from: '"Kimju Calzado" <no-reply@kimjuhogar.com>',
            to: user.email,
            subject: `✔ Pedido Confirmado #${order._id}`,
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
                    <div class="item-row" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px; margin-bottom: 10px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                             ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 40px; height: 40px; object-fit: cover; border-radius: 6px;">` : ''}
                             <div style="text-align: left;">
                                 <div style="font-size: 12px; font-weight: 700; color: #fff;">${item.name}</div>
                                 <div style="font-size: 10px; color: #94a3b8;">x${item.quantity}</div>
                             </div>
                        </div>
                        <span style="font-weight: 700; color: #EC4899;">$${item.price.toLocaleString()}</span>
                    </div>
                `).join('')}
                <div class="total">Total: $${order.totalPrice.toLocaleString()}</div>
            </div>
        `;

        const customerInfoHtml = `
            <div class="data-box">
                 <div style="text-transform: uppercase; font-weight: 900; letter-spacing: 1px; margin-bottom: 10px; color: #EC4899; border-bottom: 1px solid rgba(236, 72, 153, 0.2); padding-bottom: 5px;">Datos del Cliente</div>
                 <div style="margin-bottom: 5px;">👤 <strong style="color: #fff;">${user.name}</strong></div>
                 <div style="margin-bottom: 5px;">📧 ${user.email}</div>
                 <div style="margin-bottom: 5px;">📞 ${order.shippingAddress.phone || user.phone || 'N/A'}</div>
                 <div style="margin-bottom: 5px;">🆔 C.C. ${order.shippingAddress.legalId || 'N/A'}</div>
                 <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed rgba(255,255,255,0.1);">
                    📍 <span style="color: #fff;">${order.shippingAddress.address}</span><br/>
                    ${order.shippingAddress.neighborhood ? `${order.shippingAddress.neighborhood}, ` : ''}${order.shippingAddress.city}, ${order.shippingAddress.state}
                 </div>
            </div>
        `;

        const htmlContent = getTemplate(
            'NUEVA VENTA REALIZADA',
            `¡Excelente noticia! Se ha registrado una nueva venta en la plataforma.<br/><br/>
            ${customerInfoHtml}
            <div style="text-align: left; font-weight: 700; color: #fff; margin-bottom: 10px; text-transform: uppercase;">Detalle de Orden #${order._id}</div>
            ${itemsHtml}`,
            `https://kimjuhogar.com/admin`,
            'PANEL ADMINISTRATIVO'
        );

        const mailOptions = {
            from: '"Kimju Bot 🤖" <no-reply@kimjuhogar.com>',
            to: adminEmail,
            subject: `💰 Nueva Venta #${order._id} - $${order.totalPrice.toLocaleString()}`,
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
        const recipientEmail = order.user?.email || order.shippingAddress.email;
        const recipientName = order.user?.name || order.shippingAddress.fullName || 'Cliente';

        if (!recipientEmail) {
            console.warn(`[EMAIL WARNING] No recipient for tracking email.`);
            return false;
        }

        console.log(`[EMAIL] Sending Tracking Info to ${recipientEmail}`);

        const htmlContent = getTemplate(
            'TU PEDIDO ESTÁ EN CAMINO',
            `Hola <strong>${recipientName.split(' ')[0]}</strong>,<br/><br/>
            Tu pedido <strong>#${order._id}</strong> ha sido enviado y va en camino a tu dirección.<br/><br/>
            Número de Guía:<br/>
            <div style="font-size: 20px; font-weight: 900; color: #EC4899; background: rgba(236, 72, 153, 0.1); padding: 10px; border-radius: 10px; display: inline-block; margin: 10px 0; border: 1px dashed #EC4899; letter-spacing: 2px;">${trackingNumber}</div><br/><br/>
            Ingresa este número en la página de la transportadora para ver el estado.`,
            'https://kimjuhogar.com/profile',
            'RASTREAR PEDIDO'
        );

        const mailOptions = {
            from: '"Kimju Calzado" <no-reply@kimjuhogar.com>',
            to: recipientEmail,
            subject: `🚚 Pedido Enviado #${order._id}`,
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
            from: '"Kimju Calzado" <no-reply@kimjuhogar.com>',
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
            from: '"Kimju Calzado" <no-reply@kimjuhogar.com>',
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
