const Product = require('../models/Product');
const Category = require('../models/Category');

// @desc    Sync product from Panel (Create or Update)
// @route   POST /api/sync/products
// @access  Private (Sync Secret)
const syncProduct = async (req, res) => {
    try {
        const {
            sku,
            name,
            description,
            price,
            stock,
            image,
            category,
            type
        } = req.body;

        // --- Category Handling ---
        if (category) {
            try {
                let catDoc = await Category.findOne({ name: category });
                if (!catDoc) {
                    // Create Category if not exists
                    const slug = category.toLowerCase().replace(/ /g, '-').replace(/[^\w-]+/g, '');

                    catDoc = new Category({
                        name: category,
                        slug: slug,
                        description: `Category for ${category}`,
                        icon: 'Box' // Default icon
                    });

                    await catDoc.save();
                    console.log(`Created new category: ${category}`);
                }
            } catch (catErr) {
                console.error("Error creating category during sync:", catErr.message);
                // Continue even if category creation fails
            }
        }

        // Try to find by SKU first (if implemented), or Name as fallback
        // Note: We are adding SKU to model, so we should try to use it.
        // But for legacy data without SKU, name might be needed.
        // Ideally Panel sends SKU and we match it.

        let query = {};
        if (sku) {
            query.sku = sku;
        } else {
            query.name = name;
        }

        let product = await Product.findOne(query);

        // If not found by SKU, try Name to link existing products
        if (!product && sku && name) {
            product = await Product.findOne({ name: name });
            // If found by name but had no SKU, we will update it with SKU below
        }

        if (product) {
            // Update
            product.price = price;
            product.stock = stock;
            product.image = image;
            product.category = category;
            if (sku) product.sku = sku; // Update SKU if missing
            // product.description = description || product.description; 

            await product.save();
            return res.json({ message: 'Product updated', product });
        } else {
            // Create
            product = new Product({
                name,
                price,
                stock,
                image,
                category,
                description: description || name,
                sku: sku,
                variations: []
            });

            await product.save();
            return res.status(201).json({ message: 'Product created', product });
        }

    } catch (error) {
        console.error("Sync Error:", error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = { syncProduct };
