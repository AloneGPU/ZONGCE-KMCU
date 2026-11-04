const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/role');
const requireScopedAdmin = requireRole.requireScopedAdmin;
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
router.use('/dashboard', authenticate, requireScopedAdmin);

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

// 二级管理员账号仅允许超级管理员创建、修改和停用
router.post('/college-admins', authenticate, requireRole('admin'), userCtrl.createCollegeAdmin);
router.get('/college-admins', authenticate, requireRole('admin'), userCtrl.getCollegeAdmins);
router.put('/college-admins/:id', authenticate, requireRole('admin'), userCtrl.updateCollegeAdmin);
router.delete('/college-admins/:id', authenticate, requireRole('admin'), userCtrl.deleteCollegeAdmin);

// 教师管理 → 查看(admin+counselor)，增删(admin)
router.get('/teachers', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.getTeachers);
router.post('/teachers', authenticate, requireScopedAdmin, userCtrl.createTeacher);
router.post('/teachers/batch-delete', authenticate, requireScopedAdmin, userCtrl.batchDeleteTeachers);
router.put('/teachers/:id', authenticate, requireScopedAdmin, userCtrl.updateTeacher);
router.delete('/teachers/:id', authenticate, requireScopedAdmin, userCtrl.deleteTeacher);
router.post('/teachers/import', authenticate, requireScopedAdmin, userCtrl.importTeachers);
router.put('/teachers/:id/classes', authenticate, requireScopedAdmin, userCtrl.updateTeacherClasses);
router.put('/teachers/:id/grade', authenticate, requireScopedAdmin, userCtrl.updateTeacherGrade);

// 学生管理 → 查看(admin+counselor)，增删(admin)
router.get('/students', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.getStudents);
router.post('/students', authenticate, requireScopedAdmin, userCtrl.createStudent);
router.post('/students/batch-delete', authenticate, requireScopedAdmin, userCtrl.batchDeleteStudents);
router.delete('/students/:id', authenticate, requireScopedAdmin, userCtrl.deleteStudent);
router.post('/students/import', authenticate, requireScopedAdmin, userCtrl.importStudents);

// 学院/专业/班级统计 → admin+counselor 可看
router.get('/stats', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.getStudentStats);
router.get('/class-options', authenticate, requireScopedAdmin, userCtrl.getClassOptions);
router.post('/class-options', authenticate, requireScopedAdmin, userCtrl.createClassOption);
router.post('/class-options/batch-delete', authenticate, requireScopedAdmin, userCtrl.batchDeleteClassOptions);
router.post('/class-options/import', authenticate, requireScopedAdmin, userCtrl.importClassOptions);
router.put('/class-options/:id', authenticate, requireScopedAdmin, userCtrl.updateClassOption);
router.put('/class-options/:id/counselor', authenticate, requireScopedAdmin, userCtrl.assignClassOptionCounselor);
router.delete('/class-options/:id', authenticate, requireScopedAdmin, userCtrl.deleteClassOption);

// 获取所有学院及其下的班级列表（供级联选择器使用）
router.get('/colleges-classes', authenticate, requireRole('admin', 'college_admin', 'counselor'), async (req, res) => {
  try {
    const [colleges] = await pool.query("SELECT id, name, code FROM colleges WHERE (? IN ('admin', 'counselor') OR id = ?) ORDER BY id", [req.user.role, req.user.collegeId || 0]);
    const [classes] = await pool.query(
      `SELECT DISTINCT class_name, college_id FROM (
         SELECT class_name, college_id FROM class_options WHERE is_active = TRUE
         UNION
         SELECT class_name, college_id FROM students WHERE class_name != ''
       ) t
       WHERE class_name != '' AND (? IN ('admin', 'counselor') OR college_id = ?)
       ORDER BY class_name`
      , [req.user.role, req.user.collegeId || 0]
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
router.get('/scores', authenticate, requireScopedAdmin, submissionCtrl.getAllScores);
router.post('/scores/import', authenticate, requireScopedAdmin, submissionCtrl.importScores);
router.post('/scores/moral-deductions/import', authenticate, requireScopedAdmin, submissionCtrl.importMoralDeductions);

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
router.get('/assistants', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.getAssistants);
router.post('/assistants/promote', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.promoteToAssistant);
router.post('/assistants/demote', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.demoteFromAssistant);
router.get('/assistants/scopes', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.getAssistantReviewScopes);
router.post('/assistants/scopes', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.addAssistantReviewScope);
router.delete('/assistants/scopes/:id', authenticate, requireRole('admin', 'college_admin', 'counselor'), userCtrl.removeAssistantReviewScope);

// 全院 / 各年级 / 各班级成绩分板块导出 → 管理员专属
router.get('/export/class', authenticate, requireScopedAdmin, exportCtrl.exportClassCSV);
router.get('/export/module', authenticate, requireScopedAdmin, exportCtrl.exportModuleCSV);
router.get('/export/college', authenticate, requireScopedAdmin, exportCtrl.exportClassCSV);
router.get('/export/proofs', authenticate, requireScopedAdmin, exportCtrl.exportProofImagesZip);
router.get('/proofs/check', authenticate, requireScopedAdmin, exportCtrl.checkProofFileConsistency);
router.post('/proofs/cleanup', authenticate, requireRole('admin'), exportCtrl.cleanupOrphanProofFiles);
router.delete('/submissions/:id', authenticate, requireScopedAdmin, submissionCtrl.adminDeleteSubmission);
router.post('/submissions/batch-delete', authenticate, requireScopedAdmin, submissionCtrl.batchDeleteSubmissions);
router.get('/review', authenticate, requireScopedAdmin, submissionCtrl.getReviewList);
router.put('/review/:id', authenticate, requireScopedAdmin, submissionCtrl.review);

// 综合测评登分表导出 → 管理员专属；辅导员走 /api/counselor/export/score-table
router.get('/export/score-table', authenticate, requireScopedAdmin, scoreTableCtrl.exportScoreTable);

// 班级变更审批（管理员查看+审批辅导员的班级申请）
router.get('/class-requests', authenticate, requireRole('admin'), classRequestCtrl.getRequests);
router.put('/class-requests/:id', authenticate, requireRole('admin'), classRequestCtrl.reviewRequest);

// 数据存档 → 管理员专属
router.get('/archive', authenticate, requireRole('admin'), exportCtrl.archive);

// 仪表盘 → 管理员专属
router.get('/dashboard', authenticate, requireScopedAdmin, userCtrl.getDashboard);

module.exports = router;
