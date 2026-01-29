const express = require('express');
const router = express.Router();
const {
    getProducts,
    getProductById,
    createProduct,
    deleteProduct,
    updateProduct
} = require('../controllers/productController');
const auth = require('../middleware/authMiddleware');
// TODO: Add admin middleware check

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { uploadProducts } = require('../controllers/uploadController');

router.get('/', getProducts);
router.get('/:id', getProductById);
router.get('/:id/similar', require('../controllers/productController').getSimilarProducts);
router.post('/', auth, createProduct); // TODO: Add admin check
router.put('/:id', auth, updateProduct); // New Update Route
router.post('/batch', auth, upload.single('file'), uploadProducts); // New Bulk Route
router.delete('/:id', auth, deleteProduct); // Needs admin check later

module.exports = router;
