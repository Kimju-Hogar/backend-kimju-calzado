const express = require('express');
const router = express.Router();
const { syncProduct } = require('../controllers/productSyncController');
const { syncMiddleware } = require('../middleware/syncMiddleware');

router.post('/products', syncMiddleware, syncProduct);

module.exports = router;
