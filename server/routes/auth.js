const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');

// 公开接口
router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/send-code', authController.sendEmailCode);
router.post('/reset-password', authController.resetPassword);
router.get('/register-options', authController.getRegisterOptions);

// 需要认证的接口
router.get('/me', authenticate, authController.getMe);
router.post('/change-password', authenticate, authController.changePassword);

module.exports = router;
