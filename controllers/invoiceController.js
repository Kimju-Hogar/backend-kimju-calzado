const PDFDocument = require('pdfkit');
const Order = require('../models/Order');

// @desc    Get order invoice PDF
// @route   GET /api/orders/:id/invoice
// @access  Private
exports.getInvoice = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Security check: only admin or the order owner can download
        if (req.user.role !== 'admin' && order.user._id.toString() !== req.user.id) {
            return res.status(401).json({ message: 'Not authorized' });
        }

        const doc = new PDFDocument({ margin: 50 });

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=invoice-${order._id}.pdf`);

        doc.pipe(res);

        // --- Header ---
        doc
            .fillColor('#444444')
            .fontSize(20)
            .text('KIMJU . E X P E R I E N C E', 50, 57)
            .fontSize(10)
            .text('Valledupar, Colombia', 200, 65, { align: 'right' })
            .text('support@kimju.com', 200, 80, { align: 'right' })
            .moveDown();

        // --- Order Details ---
        doc
            .fontSize(20)
            .text('Factura de Compra', 50, 160);

        generateHr(doc, 185);

        const customerInfoTop = 200;

        doc
            .fontSize(10)
            .text(`Orden No: ${order._id.toString().toUpperCase().slice(-6)}`, 50, customerInfoTop)
            .text(`Fecha: ${new Date(order.createdAt).toLocaleDateString()}`, 50, customerInfoTop + 15)
            .text(`Estado: ${order.isPaid ? 'Pagado' : 'Pendiente'}`, 50, customerInfoTop + 30)

            .text(`Cliente: ${order.shippingAddress.name}`, 300, customerInfoTop)
            .text(`Dirección: ${order.shippingAddress.address}`, 300, customerInfoTop + 15)
            .text(`Ciudad: ${order.shippingAddress.city}, ${order.shippingAddress.country}`, 300, customerInfoTop + 30);

        generateHr(doc, 252);

        // --- Table Header ---
        const invoiceTableTop = 330;

        doc.font("Helvetica-Bold");
        generateTableRow(
            doc,
            invoiceTableTop,
            "Item",
            "Cant.",
            "Precio Unit.",
            "Total"
        );
        generateHr(doc, invoiceTableTop + 20);
        doc.font("Helvetica");

        // --- Table Rows ---
        let i = 0;
        let position = 0;

        for (const item of order.orderItems) {
            position = invoiceTableTop + (i + 1) * 30;
            generateTableRow(
                doc,
                position,
                item.name,
                item.quantity,
                formatCurrency(item.price),
                formatCurrency(item.price * item.quantity)
            );

            // Check for page break
            if (position > 700) {
                doc.addPage();
                i = 0; // Reset for new page calculation if needed, simpler logic for now
            }
            i++;
        }

        generateHr(doc, position + 20);

        // --- Totals ---
        const subtotalPosition = position + 30;

        doc.font("Helvetica-Bold");

        // Assuming shipping is free (0) based on code, usually calculated
        // If you had a subtotal separate from total, show it.
        // For now, let's just show Total.

        generateTableRow(
            doc,
            subtotalPosition,
            "",
            "",
            "Total",
            formatCurrency(order.totalPrice)
        );

        // --- Footer ---
        doc
            .fontSize(10)
            .text(
                "Gracias por tu compra. Kimju no es solo una marca, es un movimiento.",
                50,
                700,
                { align: "center", width: 500 }
            );

        doc.end();

    } catch (err) {
        console.error('Invoice generation error:', err);
        res.status(500).json({ message: 'Error generating invoice' });
    }
};

function generateHr(doc, y) {
    doc
        .strokeColor("#aaaaaa")
        .lineWidth(1)
        .moveTo(50, y)
        .lineTo(550, y)
        .stroke();
}

function formatCurrency(cents) {
    return "$" + (cents).toFixed(0).replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
}

function generateTableRow(doc, y, item, quantity, unitCost, lineTotal) {
    doc
        .fontSize(10)
        .text(item, 50, y)
        .text(quantity, 280, y, { width: 90, align: "right" })
        .text(unitCost, 370, y, { width: 90, align: "right" })
        .text(lineTotal, 0, y, { align: "right" });
}
