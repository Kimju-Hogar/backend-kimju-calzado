const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    sku: {
        type: String,
    },
    description: {
        type: String,
        required: true,
    },
    price: {
        type: Number,
        required: true,
    },
    category: {
        type: String,
        required: true,
    },
    // Simple variations (strings)
    variations: [{
        type: String
    }],
    discount: {
        type: Number,
        default: 0
    },
    image: {
        type: String,
        required: true
    },
    images: [{
        type: String, // URLs to images
    }],
    stock: {
        type: Number,
        required: true,
        default: 0,
    },
    isFeatured: {
        type: Boolean,
        default: false,
    },
    tags: [{
        type: String
    }]
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);
