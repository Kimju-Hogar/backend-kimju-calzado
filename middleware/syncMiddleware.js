const syncMiddleware = (req, res, next) => {
    const secret = req.headers['x-sync-secret'];
    if (secret && secret === process.env.SYNC_SECRET) {
        next();
    } else {
        res.status(401).json({ message: 'Not authorized, invalid sync secret' });
    }
};

module.exports = { syncMiddleware };
