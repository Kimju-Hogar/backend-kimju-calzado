const Product = require('../models/Product');

// @desc    Get all products
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
    try {
        const { category, search, includeOutOfStock } = req.query;
        let query = {};

        // 1. Stock Filtering: By default only show available products
        if (includeOutOfStock !== 'true') {
            query.stock = { $gt: 0 };
        }

        // 2. Category Filtering
        if (category && category !== 'All') {
            query.category = category;
        }

        // 3. Search Filtering
        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const products = await Product.find(query).sort({ createdAt: -1 });
        res.json(products);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Public
exports.getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ msg: 'Product not found' });
        }
        res.json(product);
    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Product not found' });
        }
        res.status(500).send('Server Error');
    }
};

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
    try {
        const { name, description, price, category, image, stock, featured, discount } = req.body;
        let { variations } = req.body;

        console.log("Create Product Request:", req.body);

        if (variations && typeof variations === 'string') {
            variations = variations.split(',').map(v => v.trim()).filter(v => v);
        } else if (!Array.isArray(variations)) {
            variations = []; // Ensure variations is an array if not provided as string or array
        }

        const newProduct = new Product({
            name,
            description,
            price,
            category: category || 'General',
            image,
            stock,
            variations,
            featured: featured || false,
            discount: discount || 0
        });

        const savedProduct = await newProduct.save();
        res.status(201).json(savedProduct);
    } catch (err) {
        console.error("Error creating product:", err);
        res.status(500).json({ message: 'Error al crear producto: ' + err.message });
    }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (product) {
            await product.deleteOne(); // updated from remove()
            res.json({ message: 'Product removed' });
        } else {
            res.status(404);
            throw new Error('Product not found');
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
exports.updateProduct = async (req, res) => {
    try {
        const { name, price, description, image, category, stock, variations, discount } = req.body;

        const product = await Product.findById(req.params.id);

        if (product) {
            product.name = name || product.name;
            product.price = price || product.price;
            product.description = description || product.description;
            product.image = image || product.image; // Handle multiple images if needed
            product.category = category || product.category;
            product.stock = stock || product.stock;
            product.variations = variations || product.variations;
            product.discount = discount || product.discount;

            const updatedProduct = await product.save();
            res.json(updatedProduct);
        } else {
            res.status(404);
            throw new Error('Product not found');
        }
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Get similar products
// @route   GET /api/products/:id/similar
// @access  Public
exports.getSimilarProducts = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Find products with same category OR shared tags, excluding the current product
        const similarProducts = await Product.find({
            _id: { $ne: product._id },
            $or: [
                { category: product.category },
                { tags: { $in: product.tags } }
            ]
        }).limit(4);

        res.json(similarProducts);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
