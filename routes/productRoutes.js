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

// El catalogo no debe quedar en la cache del navegador. Safari en iOS
// reutilizaba la lista durante horas y seguia mostrando productos que ya
// estaban en stock 0 aunque el servidor ya los filtrara.
router.use((req, res, next) => {
    if (req.method === 'GET') res.set('Cache-Control', 'no-store');
    next();
});

router.get('/', getProducts);
router.get('/:id', getProductById);
router.get('/:id/similar', require('../controllers/productController').getSimilarProducts);
router.post('/', auth, createProduct); // TODO: Add admin check
router.put('/:id', auth, updateProduct); // New Update Route
router.post('/batch', auth, upload.single('file'), uploadProducts); // New Bulk Route
router.delete('/:id', auth, deleteProduct); // Needs admin check later

module.exports = router;
