const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const pool = require('../config/database');
const submissionCtrl = require('../controllers/submissionController');
const userCtrl = require('../controllers/userController');
const { getCurrentYearId } = require('../utils/year');
const scoreTableCtrl = require('../controllers/scoreTableController');
const exportCtrl = require('../controllers/exportController');
const { assignPendingForClass } = require('../utils/reviewAssignment');

// 班委鉴权
async function requireAssistant(req, res, next) {
  try {
    const [rows] = await pool.query(
      'SELECT id, student_id, is_assistant, class_name, grade, major, college_id FROM students WHERE user_id = ? AND is_assistant = TRUE',
      [req.user.userId]
    );
    if (rows.length === 0) return res.status(403).json({ error: '无权访问，仅班委可操作' });
    req.studentInfo = rows[0];
    next();
  } catch (err) { res.status(500).json({ error: err.message }); }
}

router.use(authenticate, requireAssistant);

router.get('/export/score-table', async (req, res) => {
  req.query.className = req.studentInfo.class_name || '';
  req.query.grade = req.studentInfo.grade || '';
  return scoreTableCtrl.exportScoreTable(req, res);
});

// 仪表盘
router.get('/dashboard', async (req, res) => {
  try {
    const className = req.studentInfo.class_name;
    const grade = req.studentInfo.grade;
    const rawYear = req.query.yearId || '';
    const yearId = await getCurrentYearId(rawYear);
    await assignPendingForClass(className, grade);
    const [[{ total: totalStudents }]] = await pool.query(
      'SELECT COUNT(*) as total FROM students WHERE class_name = ? AND grade = ?', [className, grade]
    );
    const [[{ total: pendingCount }]] = await pool.query(
      `SELECT COUNT(*) as total FROM submissions sub JOIN students s ON sub.student_id = s.id
       WHERE s.class_name = ? AND s.grade = ? AND sub.academic_year_id = ?
         AND sub.status = 'pending' AND sub.assistant_assignee_id = ?`, [className, grade, yearId, req.user.userId]
    );
    res.json({ className, grade, totalStudents, pendingCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 本班学生列表
router.get('/students', async (req, res) => {
  try {
    const className = req.studentInfo.class_name;
    const grade = req.studentInfo.grade;
    const [students] = await pool.query(
      'SELECT s.*, c.name as college_name FROM students s LEFT JOIN colleges c ON s.college_id = c.id WHERE s.class_name = ? AND s.grade = ? ORDER BY s.student_id', [className, grade]
    );
    res.json({ students, className, grade });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 审核
router.get('/review', submissionCtrl.getReviewList);
router.put('/review/:id', submissionCtrl.review);

// 证明图片批量导出
router.get('/export/proofs', exportCtrl.exportProofImagesZip);

// 本班成绩排名
router.get('/scores', async (req, res) => {
  try {
    const className = req.studentInfo.class_name;
    const rawYear = req.query.yearId || req.query.year || '';
    const yearId = await getCurrentYearId(rawYear);
    const Score = require('../models/score');
    const rankings = await Score.getRankings(yearId, className, req.studentInfo.grade);
    res.json({ className, grade: req.studentInfo.grade, rankings });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 本班登分表 JSON
router.get('/scores/table', async (req, res) => {
  try {
    req.query.className = req.studentInfo.class_name;
    req.query.grade = req.studentInfo.grade || '';
    return scoreTableCtrl.getScoreTable(req, res);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
