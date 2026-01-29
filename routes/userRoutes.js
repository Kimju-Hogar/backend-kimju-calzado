const express = require('express');
const router = express.Router();
const {
    getUserProfile,
    updateUserProfile,
    addAddress,
    getUsers,
    deleteUser
} = require('../controllers/userController');
const auth = require('../middleware/authMiddleware');

router.get('/profile', auth, getUserProfile);
router.put('/profile', auth, updateUserProfile);
router.post('/address', auth, addAddress);
router.put('/address/:addressId', auth, require('../controllers/userController').updateAddress);
router.delete('/address/:addressId', auth, require('../controllers/userController').deleteAddress);
router.delete('/profile', auth, require('../controllers/userController').deleteMyAccount);

// Favorites
router.get('/favorites', auth, require('../controllers/userController').getFavorites);
router.post('/favorites/:productId', auth, require('../controllers/userController').toggleFavorite);

// Cart Persistence
router.get('/cart', auth, require('../controllers/userController').getCart);
router.post('/cart', auth, require('../controllers/userController').updateCart);

const admin = require('../middleware/adminMiddleware');

// Admin Routes
router.get('/', auth, admin, getUsers);
router.delete('/:id', auth, admin, deleteUser);

module.exports = router;
