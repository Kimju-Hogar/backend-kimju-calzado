const Category = require('../models/Category');
const Product = require('../models/Product');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Public
exports.getCategories = async (req, res) => {
    try {
        const categories = await Category.find();

        // Add product counts to each category
        const categoriesWithCounts = await Promise.all(categories.map(async (cat) => {
            const count = await Product.countDocuments({ category: cat.name });
            return {
                ...cat.toObject(),
                productCount: count
            };
        }));

        res.json(categoriesWithCounts);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Create a category
// @route   POST /api/categories
// @access  Private/Admin
exports.createCategory = async (req, res) => {
    try {
        const { name, description, image, icon } = req.body;
        console.log("Request to create category:", name);

        if (!name) {
            return res.status(400).json({ message: 'El nombre de la categoría es obligatorio.' });
        }

        const slug = name.toLowerCase().split(' ').join('-');

        const category = new Category({ name, slug, description, image, icon });
        await category.save();
        res.status(201).json(category);
    } catch (err) {
        console.error("Error creating category:", err);
        if (err.code === 11000) {
            return res.status(400).json({ message: 'La categoría ya existe.' });
        }
        res.status(400).json({ message: err.message });
    }
};

// @desc    Delete a category
// @route   DELETE /api/categories/:id
// @access  Private/Admin
exports.deleteCategory = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ message: 'Category not found' });
        }

        // Move products to 'General' category before deleting
        await Product.updateMany(
            { category: category.name },
            { category: 'General' }
        );

        await Category.findByIdAndDelete(req.params.id);
        res.json({ message: 'Category deleted and products moved to General' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// @desc    Update a category
// @route   PUT /api/categories/:id
// @access  Private/Admin
exports.updateCategory = async (req, res) => {
    try {
        const { name, image, icon } = req.body;
        const category = await Category.findById(req.params.id);

        if (!category) {
            return res.status(404).json({ message: 'Categoría no encontrada' });
        }

        category.name = name || category.name;
        category.image = image || category.image;
        category.icon = icon || category.icon;

        // Update slug if name changes
        if (name) category.slug = name.toLowerCase().split(' ').join('-');

        const updatedCategory = await category.save();
        res.json(updatedCategory);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};
