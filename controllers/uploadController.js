const Product = require('../models/Product');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// @desc    Upload products via CSV
// @route   POST /api/products/batch
// @access  Private/Admin
exports.uploadProducts = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ msg: 'No file uploaded' });
    }

    const results = [];
    const filePath = req.file.path;

    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                // Remove the temp csv file
                fs.unlinkSync(filePath);

                let addedCount = 0;

                for (let row of results) {
                    // Normalize Data
                    // 1. Variations: Assuming format "Red|Blue|XL" or "Red,Blue"
                    let variations = [];
                    if (row.variations) {
                        variations = row.variations.split(/[|,]/).map(v => v.trim());
                    } else if (row.variations_list) {
                        variations = row.variations_list.split(/[|,]/).map(v => v.trim());
                    }

                    // 2. Images: Check if it's a full URL or a local filename
                    // If it doesn't start with http, assume it's in /uploads/
                    let imageUrl = row.image || '';
                    if (imageUrl && !imageUrl.startsWith('http')) {
                        // Remove potential leading slash to avoid double slashes
                        const cleanPath = imageUrl.replace(/^\/+/, '');
                        // If user just put "silla.jpg", make it "http://localhost:5000/uploads/silla.jpg"
                        // TODO: Use env variable for base URL
                        imageUrl = `http://localhost:5000/uploads/${cleanPath}`;
                    }

                    const productData = {
                        name: row.name,
                        price: parseFloat(row.price),
                        category: row.category || 'General',
                        stock: parseInt(row.stock) || 0,
                        description: row.description || '',
                        image: imageUrl,
                        discount: row.discount ? parseInt(row.discount) : 0,
                        variations: variations
                    };

                    // Simple validation
                    if (productData.name && productData.price) {
                        await Product.create(productData);
                        addedCount++;
                    }
                }

                res.json({ msg: `${addedCount} products added successfully` });
            } catch (err) {
                console.error(err);
                res.status(500).json({ msg: 'Error processing CSV' });
            }
        });
};
