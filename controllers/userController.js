const User = require('../models/User');

// @desc    Get user profile
// @route   GET /api/users/profile
exports.getUserProfile = async (req, res) => {
    try {
        // Populate cart products if needed, but usually profile just needs user info
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
exports.updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (user) {
            user.name = req.body.name || user.name;
            user.email = req.body.email || user.email;

            // Phone validation
            if (req.body.phone) {
                const phoneRegex = /^3[0-9]{9}$/;
                if (!phoneRegex.test(req.body.phone)) {
                    return res.status(400).json({ msg: 'Número de teléfono inválido. Debe ser de Colombia (10 dígitos, empieza por 3).' });
                }
                user.phone = req.body.phone;
            }

            if (req.body.password) {
                const bcrypt = require('bcryptjs');
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(req.body.password, salt);
            }

            const updatedUser = await user.save();

            res.json({
                _id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                phone: updatedUser.phone,
                role: updatedUser.role,
                token: req.header('x-auth-token'),
                googleId: updatedUser.googleId
            });
        } else {
            res.status(404).json({ msg: 'User not found' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Add new address
// @route   POST /api/users/address
exports.addAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user) {
            user.addresses.push(req.body);
            await user.save();
            res.json(user.addresses);
        } else {
            res.status(404).json({ msg: 'User not found' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Delete Address
// @route   DELETE /api/users/address/:addressId
exports.deleteAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (user) {
            user.addresses = user.addresses.filter(
                (address) => address._id.toString() !== req.params.addressId
            );
            await user.save();
            res.json(user.addresses);
        } else {
            res.status(404).json({ msg: 'User not found' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update Address
// @route   PUT /api/users/address/:addressId
exports.updateAddress = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (user) {
            const addressIndex = user.addresses.findIndex(
                (addr) => addr._id.toString() === req.params.addressId
            );

            if (addressIndex > -1) {
                // Determine if we need to unset other defaults
                if (req.body.isDefault) {
                    user.addresses.forEach(addr => addr.isDefault = false);
                }

                user.addresses[addressIndex] = {
                    ...user.addresses[addressIndex].toObject(),
                    ...req.body,
                    _id: user.addresses[addressIndex]._id // Preserve ID
                };

                await user.save();
                res.json(user.addresses);
            } else {
                res.status(404).json({ msg: 'Address not found' });
            }
        } else {
            res.status(404).json({ msg: 'User not found' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Delete User Account (Self)
// @route   DELETE /api/users/profile
exports.deleteMyAccount = async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.user.id);
        if (!user) return res.status(404).json({ msg: 'User not found' });
        res.json({ msg: 'Cuenta eliminada correctamente.' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get all users (Admin)
// @route   GET /api/users
exports.getUsers = async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Delete user (Admin)
// @route   DELETE /api/users/:id
exports.deleteUser = async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ msg: 'User deleted' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Favorites
// @route   GET /api/users/favorites
exports.getFavorites = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('favorites');
        res.json(user.favorites);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Toggle Favorite
// @route   POST /api/users/favorites/:productId
exports.toggleFavorite = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const productId = req.params.productId;

        if (user.favorites.includes(productId)) {
            user.favorites = user.favorites.filter(id => id.toString() !== productId);
        } else {
            user.favorites.push(productId);
        }

        await user.save();

        // Return full populated favorites
        const populatedUser = await User.findById(req.user.id).populate('favorites');
        res.json(populatedUser.favorites);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Get Cart
// @route   GET /api/users/cart
exports.getCart = async (req, res) => {
    try {
        const user = await User.findById(req.user.id).populate('cart.product');
        res.json(user.cart);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};

// @desc    Update/Sync Cart
// @route   POST /api/users/cart
exports.updateCart = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const { cart } = req.body; // Expecting array of { product, quantity, variation }

        // Simple replace strategy for sync
        if (cart) {
            user.cart = cart;
            await user.save();
        }

        res.json(user.cart);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
};
