const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/role');
const userCtrl = require('../controllers/userController');
const submissionCtrl = require('../controllers/submissionController');
const scoreTableCtrl = require('../controllers/scoreTableController');
const exportCtrl = require('../controllers/exportController');
const scoringCtrl = require('../controllers/scoringController');
const pool = require('../config/database');
const Teacher = require('../models/teacher');
const Score = require('../models/score');
const { getCurrentYearId } = require('../utils/year');
const classRequestCtrl = require('../controllers/classRequestController');
const { resolveManagedClassScope, normalizeClassName, normalizeGrade } = require('../utils/className');

router.use(authenticate, requireRole('counselor'));

// 辅导员提交班级变更申请
router.post('/class-request', classRequestCtrl.createRequest);

// 辅导员工作台概览（教师信息 + 所有负责班级的统计 + 待审核数）
router.get('/overview', async (req, res) => {
  try {
    const teacher = await Teacher.findByUserId(req.user.userId);
    if (!teacher) return res.status(404).json({ error: '未找到教师信息' });

    const yearId = await getCurrentYearId(req.query.yearId || '');
    const [yearRow] = await pool.query('SELECT name FROM academic_years WHERE id = ?', [yearId]);
    const yearName = yearRow[0] ? yearRow[0].name : '';

    // 教师负责的班级（兼容 24物联网工程1班 / 2024级物联网工程一班 等写法）
    const scope = await resolveManagedClassScope(pool, teacher);
    const classNames = scope.classNames;
    const teacherGrade = scope.grade;

    // 每个班级的统计
    const classOverviews = [];
    for (const cls of classNames) {
      const classKey = normalizeClassName(cls);
      const [studentsInScopeWithGrade] = await pool.query('SELECT id, class_name, grade FROM students');
      const scopedStudentIds = studentsInScopeWithGrade.filter(s =>
        normalizeClassName(s.class_name) === classKey &&
        (!teacherGrade || normalizeGrade(s.grade) === normalizeGrade(teacherGrade))
      ).map(s => s.id);
      const studentCount = scopedStudentIds.length;
      let pendingCount = 0;
      if (scopedStudentIds.length > 0) {
        const placeholders = scopedStudentIds.map(() => '?').join(',');
        const [[row]] = await pool.query(
          `SELECT COUNT(*) as total FROM submissions
           WHERE student_id IN (${placeholders}) AND academic_year_id = ? AND (status = 'pending' OR status = 'assistant_approved')`,
          [...scopedStudentIds, yearId]
        );
        pendingCount = row.total;
      }
      // 取该班级排名（后端计算好的）
      let rankings = [];
      try {
        rankings = await Score.getRankings(yearId, cls, teacherGrade);
      } catch (e) { /* ignore */ }
      const avg = rankings.length > 0 ? (rankings.reduce((s, r) => s + r.totalScore, 0) / rankings.length).toFixed(1) : '0';
      const max = rankings.length > 0 ? Math.max(...rankings.map(r => r.totalScore)).toFixed(1) : '0';
      classOverviews.push({ className: cls, studentCount, pendingCount, avg, max });
    }

    const totalStudents = classOverviews.reduce((s, c) => s + c.studentCount, 0);
    const totalPending = classOverviews.reduce((s, c) => s + c.pendingCount, 0);

    res.json({
      teacher: { id: teacher.id, name: teacher.name, employeeId: teacher.employee_id, college_name: teacher.college_name },
      classNames,
      totalStudents,
      totalPending,
      yearName,
      grade: teacherGrade,
      configuredGrade: scope.configuredGrade,
      inferredGrade: scope.inferredGrade,
      classOverviews,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 班级成绩
router.get('/scores', submissionCtrl.getClassScores);

// 成绩导入
router.post('/scores/import', submissionCtrl.importScores);

// 审核
router.get('/review', submissionCtrl.getReviewList);
router.put('/review/:id', submissionCtrl.review);

// 导出
router.get('/export/class', exportCtrl.exportClassCSV);
router.get('/export/module', exportCtrl.exportModuleCSV);
router.get('/export/proofs', exportCtrl.exportProofImagesZip);

// 综合测评登分表（学校模板格式）
router.get('/scores/table', authenticate, scoreTableCtrl.getScoreTable);
router.get('/export/score-table', authenticate, scoreTableCtrl.exportScoreTable);

// 评分规则（辅导员只查看，规则维护由管理员负责）
router.get('/rules', scoringCtrl.getRules);

module.exports = router;
