const mongoose = require('mongoose');

// This schema matches the Panel's Product schema exactly
// so both backends (website + panel) read from the same collection.
const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    sku: {
        type: String,
        unique: true,
        trim: true
    },
    category: {
        type: String,
        required: true
    },
    distributor: {
        type: String,
        trim: true
    },
    image: {
        type: String,
        default: ''
    },
    type: {
        type: String,
        enum: ['hogar', 'calzado'],
        default: 'hogar',
        required: true
    },
    sizes: [{
        size: { type: String, required: true },
        stock: { type: Number, required: true, default: 0 }
    }],
    costPrice: {
        type: Number,
        default: 0
    },
    publicPrice: {
        type: Number,
        default: 0
    },
    margin: {
        amount: { type: Number, default: 0 },
        percentage: { type: Number, default: 0 }
    },
    stock: {
        type: Number,
        required: true,
        default: 0
    },
    minStock: {
        type: Number,
        default: 5
    },
    status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'active'
    },
    // Website-specific fields
    description: String,
    images: [String],
    isFeatured: { type: Boolean, default: false },
    discount: { type: Number, default: 0 },
    tags: [String],
    variations: [String]
}, {
    timestamps: true
});

module.exports = mongoose.model('Product', productSchema);
