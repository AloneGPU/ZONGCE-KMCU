const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/role');
const userCtrl = require('../controllers/userController');
const scoringCtrl = require('../controllers/scoringController');
const exportCtrl = require('../controllers/exportController');
const scoreTableCtrl = require('../controllers/scoreTableController');
const submissionCtrl = require('../controllers/submissionController');
const pool = require('../config/database');
const classRequestCtrl = require('../controllers/classRequestController');
const { standardizeClassNameForDisplay } = require('../utils/className');

// ==================== 子路径鉴权 ====================

// 仪表盘 → 管理员专属
router.use('/dashboard', authenticate, requireRole('admin'));

// 学年管理 → 管理员专属
router.use('/years', authenticate, requireRole('admin'));
router.get('/years', userCtrl.getYears);
router.post('/years', userCtrl.createYear);
router.put('/years/:id/deadline', userCtrl.updateYearDeadline);
router.put('/years/:id/lock', userCtrl.toggleYearLock);
router.put('/years/:id/activate', userCtrl.activateYear);
router.delete('/years/:id', userCtrl.deleteYear);

// 学院 → 所有人可读
router.get('/colleges', authenticate, userCtrl.getColleges);

// 教师管理 → 查看(admin+counselor)，增删(admin)
router.get('/teachers', authenticate, requireRole('admin', 'counselor'), userCtrl.getTeachers);
router.post('/teachers', authenticate, requireRole('admin'), userCtrl.createTeacher);
router.post('/teachers/batch-delete', authenticate, requireRole('admin'), userCtrl.batchDeleteTeachers);
router.put('/teachers/:id', authenticate, requireRole('admin'), userCtrl.updateTeacher);
router.delete('/teachers/:id', authenticate, requireRole('admin'), userCtrl.deleteTeacher);
router.post('/teachers/import', authenticate, requireRole('admin'), userCtrl.importTeachers);
router.put('/teachers/:id/classes', authenticate, requireRole('admin'), userCtrl.updateTeacherClasses);
router.put('/teachers/:id/grade', authenticate, requireRole('admin'), userCtrl.updateTeacherGrade);

// 学生管理 → 查看(admin+counselor)，增删(admin)
router.get('/students', authenticate, requireRole('admin', 'counselor'), userCtrl.getStudents);
router.post('/students', authenticate, requireRole('admin'), userCtrl.createStudent);
router.post('/students/batch-delete', authenticate, requireRole('admin'), userCtrl.batchDeleteStudents);
router.delete('/students/:id', authenticate, requireRole('admin'), userCtrl.deleteStudent);
router.post('/students/import', authenticate, requireRole('admin'), userCtrl.importStudents);

// 学院/专业/班级统计 → admin+counselor 可看
router.get('/stats', authenticate, requireRole('admin', 'counselor'), userCtrl.getStudentStats);
router.get('/class-options', authenticate, requireRole('admin'), userCtrl.getClassOptions);
router.post('/class-options', authenticate, requireRole('admin'), userCtrl.createClassOption);
router.post('/class-options/batch-delete', authenticate, requireRole('admin'), userCtrl.batchDeleteClassOptions);
router.post('/class-options/import', authenticate, requireRole('admin'), userCtrl.importClassOptions);
router.put('/class-options/:id', authenticate, requireRole('admin'), userCtrl.updateClassOption);
router.put('/class-options/:id/counselor', authenticate, requireRole('admin'), userCtrl.assignClassOptionCounselor);
router.delete('/class-options/:id', authenticate, requireRole('admin'), userCtrl.deleteClassOption);

// 获取所有学院及其下的班级列表（供级联选择器使用）
router.get('/colleges-classes', authenticate, requireRole('admin', 'counselor'), async (req, res) => {
  try {
    const [colleges] = await pool.query('SELECT id, name, code FROM colleges ORDER BY id');
    const [classes] = await pool.query(
      `SELECT DISTINCT class_name, college_id FROM (
         SELECT class_name, college_id FROM class_options WHERE is_active = TRUE
         UNION
         SELECT class_name, college_id FROM students WHERE class_name != ''
       ) t
       WHERE class_name != ''
       ORDER BY class_name`
    );
    const result = colleges.map(col => ({
      ...col,
      classes: Array.from(new Set(classes
        .filter(c => c.college_id === col.id)
        .map(c => standardizeClassNameForDisplay(c.class_name))))
    }));
    res.json({ colleges: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 全院实时排名 → 管理员专属
router.get('/scores', authenticate, requireRole('admin'), submissionCtrl.getAllScores);
router.post('/scores/import', authenticate, requireRole('admin'), submissionCtrl.importScores);
router.post('/scores/moral-deductions/import', authenticate, requireRole('admin'), submissionCtrl.importMoralDeductions);

// 评分规则 → 查看(admin+counselor)，修改(admin)
router.get('/rules', authenticate, scoringCtrl.getRules);
router.post('/rules/modules', authenticate, requireRole('admin'), scoringCtrl.createModule);
router.put('/rules/modules/:id', authenticate, requireRole('admin'), scoringCtrl.updateModule);
router.delete('/rules/modules/:id', authenticate, requireRole('admin'), scoringCtrl.deleteModule);
router.post('/rules/items', authenticate, requireRole('admin'), scoringCtrl.createItem);
router.put('/rules/items/:id', authenticate, requireRole('admin'), scoringCtrl.updateItem);
router.delete('/rules/items/:id', authenticate, requireRole('admin'), scoringCtrl.deleteItem);
router.put('/rules/lock', authenticate, requireRole('admin'), scoringCtrl.toggleLock);

// 班委管理 → admin+counselor
router.get('/assistants', authenticate, requireRole('admin', 'counselor'), userCtrl.getAssistants);
router.post('/assistants/promote', authenticate, requireRole('admin', 'counselor'), userCtrl.promoteToAssistant);
router.post('/assistants/demote', authenticate, requireRole('admin', 'counselor'), userCtrl.demoteFromAssistant);

// 全院 / 各年级 / 各班级成绩分板块导出 → 管理员专属
router.get('/export/class', authenticate, requireRole('admin'), exportCtrl.exportClassCSV);
router.get('/export/module', authenticate, requireRole('admin'), exportCtrl.exportModuleCSV);
router.get('/export/college', authenticate, requireRole('admin'), exportCtrl.exportClassCSV);
router.get('/export/proofs', authenticate, requireRole('admin'), exportCtrl.exportProofImagesZip);
router.get('/proofs/check', authenticate, requireRole('admin'), exportCtrl.checkProofFileConsistency);
router.post('/proofs/cleanup', authenticate, requireRole('admin'), exportCtrl.cleanupOrphanProofFiles);
router.delete('/submissions/:id', authenticate, requireRole('admin'), submissionCtrl.adminDeleteSubmission);
router.post('/submissions/batch-delete', authenticate, requireRole('admin'), submissionCtrl.batchDeleteSubmissions);
router.get('/review', authenticate, requireRole('admin'), submissionCtrl.getReviewList);

// 综合测评登分表导出 → 管理员专属；辅导员走 /api/counselor/export/score-table
router.get('/export/score-table', authenticate, requireRole('admin'), scoreTableCtrl.exportScoreTable);

// 班级变更审批（管理员查看+审批辅导员的班级申请）
router.get('/class-requests', authenticate, requireRole('admin'), classRequestCtrl.getRequests);
router.put('/class-requests/:id', authenticate, requireRole('admin'), classRequestCtrl.reviewRequest);

// 数据存档 → 管理员专属
router.get('/archive', authenticate, requireRole('admin'), exportCtrl.archive);

// 仪表盘 → 管理员专属
router.get('/dashboard', authenticate, requireRole('admin'), userCtrl.getDashboard);

module.exports = router;
