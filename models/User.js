const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: function () { return !this.googleId; } // Not required if using Google
    },
    resetPasswordToken: String,
    resetPasswordExpire: Date,
    phone: {
        type: String, // For OTP/Phone login
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    googleId: {
        type: String,
    },
    addresses: [{
        street: String,
        city: String,
        state: String,
        neighborhood: String,
        zip: String,
        country: String,
        additionalInfo: String,
        phone: String, // Contact phone for this address
        isDefault: { type: Boolean, default: false }
    }],
    avatar: {
        type: String
    },
    favorites: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    }],
    cart: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            default: 1
        },
        selectedVariation: {
            type: String
        }
    }]
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
