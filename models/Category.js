const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    slug: {
        type: String,
        lowercase: true,
        unique: true
    },
    description: {
        type: String
    },
    image: {
        type: String // URL to icon or image
    },
    icon: {
        type: String // Name of the Lucide icon
    }
}, { timestamps: true });

// Removed pre-save hook to avoid 'next is not a function' errors. Slug is generated in controller.

module.exports = mongoose.model('Category', CategorySchema);
