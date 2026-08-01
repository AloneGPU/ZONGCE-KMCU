const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/role');
const ctrl = require('../controllers/notificationController');

// 所有登录用户可查看自己可见的公告
router.get('/', authenticate, ctrl.getAnnouncements);

// 管理员/辅导员/班委可发布公告
router.post('/', authenticate, requireRole('admin'), ctrl.createAnnouncement);

// 删除自己的公告（管理员可删任何人的）
router.delete('/:id', authenticate, ctrl.deleteAnnouncement);

module.exports = router;
