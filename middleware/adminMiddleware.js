const User = require('../models/User');

const admin = async (req, res, next) => {
    try {
        // req.user is set by authMiddleware
        const user = await User.findById(req.user.id);

        if (user && user.role === 'admin') {
            next();
        } else {
            res.status(403).json({ msg: 'Not authorized as an admin' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

module.exports = admin;
