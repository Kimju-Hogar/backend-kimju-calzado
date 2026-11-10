const Product = require('../models/Product');

const PRICE_MARKUP = 1.03; // 3% markup for website price
const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || 'https://api.kimjuhogar.com';
const PRODUCT_TYPE = process.env.PRODUCT_TYPE || 'calzado';

// Transform Panel product → Website product format (with sizes for calzado)
const transformProduct = (product) => {
    const p = product.toObject ? product.toObject() : product;

    // Build absolute image URL
    let imageUrl = p.image || '';
    if (imageUrl && !imageUrl.startsWith('http')) {
        const cleanPath = imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`;
        imageUrl = `${IMAGE_BASE_URL}${cleanPath}`;
    }

    return {
        _id: p._id,
        name: p.name,
        sku: p.sku,
        description: p.description || '',
        price: p.publicPrice,
        category: p.category,
        image: imageUrl,
        images: p.images || [],
        stock: p.stock,
        type: p.type || PRODUCT_TYPE,
        sizes: p.sizes || [],
        colors: p.colors || [],
        variations: p.variations || [],
        isFeatured: p.isFeatured || false,
        discount: p.discount || 0,
        tags: p.tags || [],
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
    };
};

// Un producto con tallas o colores solo se puede comprar si alguna variante
// tiene unidades. El stock global puede quedar en positivo mientras todas las
// tallas estan en 0 (el Panel guarda los dos por separado), y eso hacia que
// el producto apareciera en la tienda sin ninguna opcion disponible.
const hasPurchasableStock = (p) => {
    if (Array.isArray(p.sizes) && p.sizes.length > 0) return p.sizes.some((s) => Number(s.stock) > 0);
    if (Array.isArray(p.colors) && p.colors.length > 0) return p.colors.some((c) => Number(c.stock) > 0);
    return Number(p.stock) > 0;
};

// @desc    Get all products (filtered by type from env)
// @route   GET /api/products
// @access  Public
exports.getProducts = async (req, res) => {
    try {
        const { category, search, includeOutOfStock } = req.query;
        let query = { type: PRODUCT_TYPE, status: 'active' };
        const soloDisponibles = includeOutOfStock !== 'true';

        if (soloDisponibles) {
            query.stock = { $gt: 0 };
        }

        if (category && category !== 'All') {
            query.category = category;
        }

        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        let products = await Product.find(query).sort({ createdAt: -1 });
        if (soloDisponibles) products = products.filter(hasPurchasableStock);
        res.json(products.map(transformProduct));
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
        const product = await Product.findOne({ _id: req.params.id, type: PRODUCT_TYPE });
        if (!product) {
            return res.status(404).json({ msg: 'Product not found' });
        }
        res.json(transformProduct(product));
    } catch (err) {
        console.error(err.message);
        if (err.kind === 'ObjectId') {
            return res.status(404).json({ msg: 'Product not found' });
        }
        res.status(500).send('Server Error');
    }
};

// @desc    Create a product (kept for backward compat, products should be created via Panel)
// @route   POST /api/products
// @access  Private/Admin
exports.createProduct = async (req, res) => {
    try {
        const { name, description, price, category, image, stock, featured, discount } = req.body;
        let { variations } = req.body;

        if (variations && typeof variations === 'string') {
            variations = variations.split(',').map(v => v.trim()).filter(v => v);
        } else if (!Array.isArray(variations)) {
            variations = [];
        }

        const newProduct = new Product({
            name,
            description,
            publicPrice: price,
            costPrice: 0,
            category: category || 'General',
            image,
            stock,
            variations,
            type: PRODUCT_TYPE,
            isFeatured: featured || false,
            discount: discount || 0
        });

        const savedProduct = await newProduct.save();
        res.status(201).json(transformProduct(savedProduct));
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
        const product = await Product.findOne({ _id: req.params.id, type: PRODUCT_TYPE });
        if (product) {
            await product.deleteOne();
            res.json({ message: 'Product removed' });
        } else {
            res.status(404).json({ message: 'Product not found' });
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
        const product = await Product.findOne({ _id: req.params.id, type: PRODUCT_TYPE });

        if (product) {
            product.name = name || product.name;
            product.publicPrice = price || product.publicPrice;
            product.description = description || product.description;
            product.image = image || product.image;
            product.category = category || product.category;
            product.stock = stock != null ? stock : product.stock;
            product.variations = variations || product.variations;
            product.discount = discount || product.discount;

            const updatedProduct = await product.save();
            res.json(transformProduct(updatedProduct));
        } else {
            res.status(404).json({ message: 'Product not found' });
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
        const product = await Product.findOne({ _id: req.params.id, type: PRODUCT_TYPE });
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Se piden mas de los 4 que se muestran porque despues se descartan
        // los que no tienen ninguna talla/color disponible.
        const similarProducts = await Product.find({
            _id: { $ne: product._id },
            type: PRODUCT_TYPE,
            status: 'active',
            stock: { $gt: 0 },
            $or: [
                { category: product.category },
                { tags: { $in: product.tags || [] } }
            ]
        }).limit(12);

        res.json(similarProducts.filter(hasPurchasableStock).slice(0, 4).map(transformProduct));
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
