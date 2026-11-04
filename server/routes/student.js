const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/role');
const submissionCtrl = require('../controllers/submissionController');
const upload = require('../utils/upload');

router.use(authenticate, requireRole('student'));

// 成绩
router.get('/scores', submissionCtrl.getMyScores);
router.get('/imported-scores', submissionCtrl.getMyImportedScores);

// 提交材料 — 带文件上传
router.get('/submissions', submissionCtrl.getMySubmissions);
router.post('/submissions', upload.array('proofs', 10), submissionCtrl.create);
router.put('/submissions/:id', upload.array('proofs', 10), submissionCtrl.updateMySubmission);
router.delete('/submissions/:id', submissionCtrl.deleteMySubmission);

module.exports = router;
