const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadPath = path.resolve(__dirname, '../uploads');
if (!fs.existsSync(uploadPath)) {
    fs.mkdirSync(uploadPath, { recursive: true });
}

// Storage configuration
// Storage configuration
const storage = multer.diskStorage({
    destination(req, file, cb) {
        const uploadPath = path.resolve(__dirname, '../uploads');
        cb(null, uploadPath);
    },
    filename(req, file, cb) {
        cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
    }
});

// Check file type
function checkFileType(file, cb) {
    const filetypes = /jpg|jpeg|png|webp|gif/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('Only images (jpg, jpeg, png, webp, gif) are allowed!'));
    }
}

const upload = multer({
    storage,
    fileFilter: function (req, file, cb) {
        checkFileType(file, cb);
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Single Image Upload Endpoint
exports.uploadImage = (req, res) => {
    const uploader = upload.single('image');

    uploader(req, res, function (err) {
        if (err) {
            console.error("Multer Error:", err);
            return res.status(500).json({ message: err.message || "Error al subir la imagen" });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'No file selected' });
        }

        // Return a consistent path for the frontend
        const filePath = `/uploads/${req.file.filename}`;

        res.json({
            message: 'Image uploaded',
            filePath: filePath
        });
    });
};
