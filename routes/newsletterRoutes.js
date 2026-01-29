const express = require('express');
const router = express.Router();
const { subscribeCallback } = require('../controllers/newsletterController');

router.post('/', subscribeCallback);

module.exports = router;
