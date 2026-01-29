const express = require('express');
const router = express.Router();
const { registerUser, loginUser } = require('../controllers/authController');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/forgot-password', require('../controllers/authController').forgotPassword);
router.put('/reset-password/:resetToken', require('../controllers/authController').resetPassword);
router.post('/google', require('../controllers/authController').googleLogin);

module.exports = router;
