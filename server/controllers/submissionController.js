const Submission = require('../models/submission');
const Student = require('../models/student');
const Teacher = require('../models/teacher');
const Score = require('../models/score');
const pool = require('../config/database');
const { getCurrentYearId } = require('../utils/year');
const auditLog = require('../utils/audit');
const { resolveManagedClassScope, canonicalizeClassNames, normalizeClassName, normalizeGrade } = require('../utils/className');
const { assignPendingForClass } = require('../utils/reviewAssignment');

function cleanupIncomingFile(file) {
  if (!file || !file.path) return;
  try {
    require('fs').unlinkSync(file.path);
  } catch (e) { /* ignore cleanup errors */ }
}

// 归档锁定的学年拒绝一切数据变更（提交/修改/删除/审核/成绩导入）
async function assertYearNotLocked(yearId) {
  const [rows] = await pool.query('SELECT is_locked FROM academic_years WHERE id = ?', [yearId]);
  if (rows[0] && rows[0].is_locked) {
    const error = new Error('该学年已归档锁死，不能修改或审核数据');
    error.statusCode = 403;
    throw error;
  }
}

async function assertCanReviewSubmission(req, submission) {
  if (!submission) {
    const error = new Error('提交记录不存在');
    error.statusCode = 404;
    throw error;
  }

  if (req.studentInfo && req.studentInfo.is_assistant) {
    const sameClass = normalizeClassName(req.studentInfo.class_name) === normalizeClassName(submission.class_name);
    const sameGrade = normalizeGrade(req.studentInfo.grade) === normalizeGrade(submission.grade);
    if (!sameClass || !sameGrade) {
      const error = new Error('无权审核其他班级或年级的材料');
      error.statusCode = 403;
      throw error;
    }
    if (Number(submission.assistant_assignee_id) !== Number(req.user.userId)) {
      const error = new Error('该材料未分配给当前班委');
      error.statusCode = 403;
      throw error;
    }
    return 'assistant';
  }

  if (req.user.role === 'counselor') {
    const teacher = await Teacher.findByUserId(req.user.userId);
    const scope = await resolveManagedClassScope(pool, teacher);
    const inClass = scope.classNames.some(item => normalizeClassName(item) === normalizeClassName(submission.class_name));
    const inGrade = !scope.grade || normalizeGrade(scope.grade) === normalizeGrade(submission.grade);
    if (!inClass || !inGrade) {
      const error = new Error('无权审核非负责班级或年级的材料');
      error.statusCode = 403;
      throw error;
    }
    return 'counselor';
  }

  const error = new Error('当前角色不参与材料审核');
  error.statusCode = 403;
  throw error;
}

// ==================== 学生提交材料 ====================
exports.create = async (req, res) => {
  let finalizedProofPath = '';
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) {
      cleanupIncomingFile(req.file);
      return res.status(404).json({ error: '未找到学生信息' });
    }

    const { moduleId, itemId } = req.body;
    const description = String(req.body.description || '无').trim() || '无';
    const awardMonth = String(req.body.award_month || req.body.awardMonth || '').trim();
    let academicYearId = req.body.academicYearId;
    if (!moduleId || !itemId) {
      cleanupIncomingFile(req.file);
      return res.status(400).json({ error: '请选择加分项' });
    }
    if (awardMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(awardMonth)) {
      cleanupIncomingFile(req.file);
      return res.status(400).json({ error: '奖项获得时间格式不正确，请选择到月份' });
    }

    // 支持学年名称（如 '2025-2026'）或数字 ID
    if (academicYearId && String(academicYearId).includes('-')) {
      const [yr] = await pool.query('SELECT id FROM academic_years WHERE name = ?', [academicYearId]);
      academicYearId = yr[0] ? yr[0].id : null;
    }
    if (!academicYearId) {
      const [yr] = await pool.query('SELECT id FROM academic_years WHERE is_current = TRUE LIMIT 1');
      academicYearId = yr[0] ? yr[0].id : 2;
    }
    academicYearId = parseInt(academicYearId);

    // 查加分项，使用 max_score 作为固定分值（V2 规则：学生不输入分数）
    const [itemRows] = await pool.query(
      `SELECT si.*, sm.name as module_name
       FROM scoring_items si
       JOIN scoring_modules sm ON si.module_id = sm.id
       WHERE si.id = ? AND si.module_id = ?`, [itemId, moduleId]
    );
    if (itemRows.length === 0) {
      cleanupIncomingFile(req.file);
      return res.status(400).json({ error: '该加分项不存在' });
    }
    const item = itemRows[0];
    if (!item.requires_proof || item.requires_proof === 0) {
      cleanupIncomingFile(req.file);
      return res.status(400).json({ error: '此项为考试成绩类，由教师统一导入，学生无需提交' });
    }

    // 使用规则表中预设的固定分值，支持次数倍增
    const rawCount = req.body.count === undefined || req.body.count === '' ? 1 : Number(req.body.count);
    if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > 100) {
      cleanupIncomingFile(req.file);
      return res.status(400).json({ error: '申报次数必须是 1 至 100 的整数' });
    }
    const count = rawCount;
    const submittedScore = (parseFloat(item.max_score) || 0) * count;
    if (submittedScore <= 0) {
      cleanupIncomingFile(req.file);
      return res.status(400).json({ error: '该加分项未配置分值，请联系管理员' });
    }

    // 获取学年名
    const yearId = await getCurrentYearId(academicYearId);
    await assertYearNotLocked(yearId);
    const [yearRows] = await pool.query('SELECT name FROM academic_years WHERE id = ?', [yearId]);
    const yearName = yearRows[0] ? yearRows[0].name : 'unknown';

    // 处理上传图片。最终文件名由服务端根据学生、加分模块和分值生成，避免前端伪造。
    if (!req.file) {
      return res.status(400).json({ error: '请上传证明图片，仅支持 JPG/PNG/GIF，大小不超过 10MB' });
    }
    const studentProofName = String(req.body.proof_name || '').trim();
    if (!studentProofName) {
      cleanupIncomingFile(req.file);
      return res.status(400).json({ error: '请填写证明图片名称' });
    }

    const path = require('path');
    const fs = require('fs');
    const { moveToFinalDir, validateMagicNumber, sanitizeFilePart, getUploadRoot } = require('../utils/upload');
    const extByMime = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' };
    const ext = extByMime[req.file.mimetype] || path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const customName = sanitizeFilePart(path.basename(studentProofName, path.extname(studentProofName)), '证明材料');
    const moduleLabel = String(item.module_name || '加分项').endsWith('类') ? item.module_name : `${item.module_name || '加分项'}类`;
    const scoreText = Number.isInteger(submittedScore) ? String(submittedScore) : submittedScore.toFixed(1).replace(/\.0$/, '');
    const finalFilename = [
      sanitizeFilePart(student.student_id, '学号'),
      sanitizeFilePart(student.name, '姓名'),
      sanitizeFilePart(moduleLabel, '加分类'),
      sanitizeFilePart(`${scoreText}分`, '分值'),
      customName
    ].join('_') + ext;

    let proofFilename = finalFilename;
    let proofPath = '';
    const moved = moveToFinalDir(req.file.filename, yearName, student.student_id, finalFilename);
    proofPath = moved.proofPath;
    proofFilename = moved.filename;
    finalizedProofPath = proofPath;

    // 文件写入后再校验 magic number（不能提前验，否则 stream 数据丢失）
    const fullPath = path.join(getUploadRoot(), proofPath);
    const valid = validateMagicNumber(fullPath, req.file.mimetype);
    if (!valid) {
      fs.unlinkSync(fullPath);
      finalizedProofPath = '';
      return res.status(400).json({ error: '文件类型与实际内容不符，请上传真实图片' });
    }

    const sub = await Submission.create({
      studentId: student.id,
      academicYearId: yearId,
      moduleId, itemId,
      score: submittedScore,
      description,
      awardMonth,
      proofFilename,
      proofPath,
      initialStatus: student.is_assistant ? 'assistant_approved' : 'pending',
    });

    if (sub.status === 'pending') {
      try {
        await assignPendingForClass(student.class_name, student.grade);
      } catch (assignErr) {
        console.error('班委评审任务自动分配失败:', assignErr.message);
      }
    }

    await auditLog(req, 'submission.create', 'submission', sub.id, { studentId: student.id, yearId, moduleId, itemId, score: submittedScore });
    finalizedProofPath = '';
    res.status(201).json({ submission: sub });
  } catch (err) {
    cleanupIncomingFile(req.file);
    if (finalizedProofPath) {
      try {
        require('../utils/upload').deleteStoredFile(finalizedProofPath);
      } catch (cleanupErr) {
        console.error('提交失败后的材料文件清理失败:', cleanupErr.message);
      }
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.getMySubmissions = async (req, res) => {
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) return res.status(404).json({ error: '未找到学生信息' });

    const subs = await Submission.findByStudent(student.id);
    res.json({ submissions: subs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateMySubmission = async (req, res) => {
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) return res.status(404).json({ error: '未找到学生信息' });

    // 只允许改本人材料：不存在或非本人的记录一律 404
    const sub = await Submission.findByIdForStudent(req.params.id, student.id);
    if (!sub) return res.status(404).json({ error: '提交记录不存在' });
    await assertYearNotLocked(sub.academic_year_id);
    // pending 和 rejected 的可以修改
    if (sub.status !== 'pending' && sub.status !== 'rejected') {
      return res.status(400).json({ error: '只能修改待审核或被驳回的提交' });
    }

    const description = String(req.body.description || '无').trim() || '无';
    const awardMonth = req.body.award_month !== undefined || req.body.awardMonth !== undefined
      ? String(req.body.award_month || req.body.awardMonth || '').trim()
      : undefined;
    if (awardMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(awardMonth)) {
      return res.status(400).json({ error: '奖项获得时间格式不正确，请选择到月份' });
    }
    // 如果是被驳回的，修改后重置为 pending
    const newStatus = sub.status === 'rejected' ? 'pending' : undefined;
    const updates = { description, status: newStatus };
    if (awardMonth !== undefined) updates.award_month = awardMonth || null;
    await Submission.update(req.params.id, updates);
    await auditLog(req, 'submission.update', 'submission', req.params.id, { description, awardMonth });
    res.json({ message: '已更新' + (newStatus ? '，已重新提交审核' : '') });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.deleteMySubmission = async (req, res) => {
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) return res.status(404).json({ error: '未找到学生信息' });

    const sub = await Submission.findByIdForStudent(req.params.id, student.id);
    if (!sub) return res.status(404).json({ error: '提交记录不存在' });
    await assertYearNotLocked(sub.academic_year_id);
    // pending 和 rejected 的可以删除
    if (sub.status !== 'pending' && sub.status !== 'rejected') {
      return res.status(400).json({ error: '只能删除待审核或被驳回的提交' });
    }

    await Submission.delete(req.params.id);
    // 物理删除本人材料文件，避免已删材料在磁盘上残留；
    // deleteStoredFile 内部经 resolveStoredFile 限定在 UPLOAD_ROOT 内，删除失败不影响结果。
    if (sub.proof_path) {
      try {
        require('../utils/upload').deleteStoredFile(sub.proof_path);
      } catch (cleanupErr) {
        console.error('材料记录已删除，但图片文件清理失败:', cleanupErr.message);
      }
    }
    await auditLog(req, 'submission.delete', 'submission', req.params.id, { studentId: student.id });
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// ==================== 管理员强制删除 ====================
// 用于清理违规/不当内容。删除已通过材料会改变对应学生成绩，前端需二次确认。
exports.adminDeleteSubmission = async (req, res) => {
  try {
    const sub = await Submission.findById(req.params.id);
    if (!sub) return res.status(404).json({ error: '提交记录不存在' });
    await assertYearNotLocked(sub.academic_year_id);

    await Submission.delete(sub.id);
    if (sub.proof_path) {
      try {
        require('../utils/upload').deleteStoredFile(sub.proof_path);
      } catch (cleanupErr) {
        console.error('管理员删除材料后图片清理失败:', cleanupErr.message);
      }
    }
    await auditLog(req, 'submission.admin_delete', 'submission', sub.id, {
      studentId: sub.student_id, status: sub.status,
    });
    res.json({ message: '已强制删除该材料，成绩将随之重新计算' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// ==================== 辅导员强制删除 ====================
// 仅限删除辅导员本人负责班级内的材料；归档锁定学年一律拒绝。
exports.counselorDeleteSubmission = async (req, res) => {
  try {
    const sub = await Submission.findById(req.params.id);
    if (!sub) return res.status(404).json({ error: '提交记录不存在' });
    await assertYearNotLocked(sub.academic_year_id);

    // 先校验班级归属：只能删除自己负责班级内的材料
    const teacher = await Teacher.findByUserId(req.user.userId);
    if (!teacher) return res.status(404).json({ error: '未找到教师信息' });
    const scope = await resolveManagedClassScope(pool, teacher);
    if (scope.classNames.length === 0) {
      return res.status(403).json({ error: '未配置负责班级，无权删除材料' });
    }
    const [studentRows] = await pool.query('SELECT class_name, grade FROM students WHERE id = ?', [sub.student_id]);
    const stu = studentRows[0];
    if (!stu) return res.status(404).json({ error: '学生信息不存在' });
    const allowed = scope.classNames.some(item => (
      normalizeClassName(item) === normalizeClassName(stu.class_name) &&
        (!scope.grade || normalizeGrade(scope.grade) === normalizeGrade(stu.grade))
    ));
    if (!allowed) return res.status(403).json({ error: '该材料不属于当前负责的班级，无权删除' });

    await Submission.delete(sub.id);
    if (sub.proof_path) {
      try {
        require('../utils/upload').deleteStoredFile(sub.proof_path);
      } catch (cleanupErr) {
        console.error('辅导员删除材料后图片清理失败:', cleanupErr.message);
      }
    }
    await auditLog(req, 'submission.counselor_delete', 'submission', sub.id, {
      studentId: sub.student_id, status: sub.status,
    });
    res.json({ message: '已删除该材料，成绩将随之重新计算' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// ==================== 审核流程 ====================
exports.getReviewList = async (req, res) => {
  try {
    const { status, yearId } = req.query;
    const role = req.user.role;
    const yearIdNum = await getCurrentYearId(yearId);

    let subs;

    if (role === 'admin') {
      subs = await Submission.findByYear(yearIdNum);
    } else if (role === 'counselor') {
      const teacher = await Teacher.findByUserId(req.user.userId);
      if (!teacher) return res.status(404).json({ error: '未找到教师信息' });
      const scope = await resolveManagedClassScope(pool, teacher);
      const classNames = scope.classNames;
      if (classNames.length > 0) {
        subs = await Submission.findPendingByTeacherClass(classNames, yearIdNum, scope.grade);
      } else {
        return res.json({ submissions: [], message: '未配置负责班级，请联系管理员在教师管理中分配班级' });
      }
    } else {
      // 助理/班委：从 req 或 students 表获取 class_name
      const className = (req.studentInfo && req.studentInfo.class_name)
        || ((await Student.findByUserId(req.user.userId)) || {}).class_name || '';
      if (!className) return res.status(404).json({ error: '未找到助理信息' });
      const assistantGrade = req.studentInfo && req.studentInfo.grade;
      await assignPendingForClass(className, assistantGrade);
      subs = await Submission.findPendingByClass(className, yearIdNum, assistantGrade, req.user.userId);
    }

    // 辅导员：始终隐藏有助理班级中 pending 状态的材料（必须等班委先审）
    if (role === 'counselor') {
      const pendingSubs = subs.filter(s => s.status === 'pending');
      if (pendingSubs.length > 0) {
        const ids = pendingSubs.map(s => s.student_id);
        const ph = ids.map(() => '?').join(',');
        const [asstRows] = await pool.query(
          'SELECT s1.id AS sid FROM students s1 JOIN students s2 ON s1.class_name = s2.class_name AND s1.grade = s2.grade AND s2.is_assistant = TRUE AND s2.class_name != \'\' WHERE s1.id IN (' + ph + ')',
          ids
        );
        const hasAsst = new Set(asstRows.map(r => r.sid));
        subs = subs.filter(s => s.status !== 'pending' || !hasAsst.has(s.student_id));
      }
    }

    // 按前端 status 参数做二次筛选
    if (status === 'pending') {
      if (role === 'admin') {
        subs = subs.filter(s => s.status === 'pending' || s.status === 'assistant_approved');
      } else if (role === 'counselor') {
        subs = subs.filter(s => s.status === 'pending' || s.status === 'assistant_approved');
      } else {
        subs = subs.filter(s => s.status === 'pending');
      }
    } else if (status === 'reviewed') {
      subs = subs.filter(s => s.status === 'approved' || s.status === 'rejected');
    }

    res.json({ submissions: subs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.review = async (req, res) => {
  try {
    const { action, reason } = req.body; // 'approve' | 'reject'
    const subId = req.params.id;

    const submission = await Submission.findById(subId);
    await assertYearNotLocked(submission.academic_year_id);
    const reviewerRole = await assertCanReviewSubmission(req, submission);

    if (action === 'approve') {
      const approved = await Submission.approve(subId, reviewerRole, req.user.userId);
      await auditLog(req, 'submission.approve', 'submission', subId, { status: approved.status });
      const statusText = approved.status === 'assistant_approved'
        ? '班委已审核通过，等待辅导员终审'
        : '审核全部通过';
      res.json({ message: statusText, submission: approved });
    } else if (action === 'reject') {
      const rejected = await Submission.reject(subId, reviewerRole, req.user.userId, reason);
      await auditLog(req, 'submission.reject', 'submission', subId, { reason });
      res.json({ message: '已拒绝', submission: rejected });
    } else {
      res.status(400).json({ error: '无效操作' });
    }
  } catch (err) {
    // 业务逻辑错误（如越级审批）返回 400
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (err.message.includes('无法') || err.message.includes('等待') || err.message.includes('重复') || err.message.includes('状态已变化')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
};

// ==================== 学生成绩 ====================
exports.getMyScores = async (req, res) => {
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) return res.status(404).json({ error: '未找到学生信息' });

    // yearId 可以是数字ID 或 学年名称（如 '2025-2026'）
    let yearId = await getCurrentYearId(req.query.yearId || req.query.year);
    const rawYear = req.query.yearId || req.query.year || '';
    const numericId = parseInt(rawYear);
    if (numericId > 0 && numericId < 100) {
      yearId = numericId; // 数字 ID
    } else if (rawYear && rawYear.includes('-')) {
      const [yr] = await pool.query('SELECT id FROM academic_years WHERE name = ?', [rawYear]);
      yearId = yr[0] ? yr[0].id : yearId;
    }
    const [modRows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    const [itemRows] = await pool.query('SELECT * FROM scoring_items ORDER BY sort_order');
    await Score.ensureBaseScores();

    const moduleScores = [];
    for (const mod of modRows) {
      const modScore = await Score.calcModuleScore(student.id, yearId, mod.id);
      const modItems = itemRows.filter(i => i.module_id === mod.id);
      const baseScore = Score.moduleBaseScore(mod.id);
      moduleScores.push({ ...mod, score: modScore, baseScore, finalScore: modScore + baseScore, items: modItems });
    }

    const totalScore = await Score.calcTotalScore(student.id, yearId);
    const rankings = await Score.getRankings(yearId, student.class_name, student.grade);
    const myRank = rankings.find(r => r.studentId == student.id);

    // 同时返回导入成绩明细（让前端能精确展示）
    const [importedRows] = await pool.query(
      `SELECT isc.*, si.name as item_name, sm.name as module_name
       FROM imported_scores isc
       LEFT JOIN scoring_items si ON isc.item_id = si.id
       LEFT JOIN scoring_modules sm ON isc.module_id = sm.id
       WHERE isc.student_id = ? AND isc.academic_year_id = ?`,
      [student.id, yearId]
    );

    res.json({
      student,
      totalScore,
      rank: myRank ? myRank.rank : null,
      totalInClass: rankings.length,
      moduleScores,
      importedScores: importedRows,
      rankings: rankings.slice(0, 10),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 学生查看自己的导入成绩
exports.getMyImportedScores = async (req, res) => {
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) return res.status(404).json({ error: '未找到学生信息' });

    const yearId = await getCurrentYearId(req.query.yearId);
    const [rows] = await pool.query(
      `SELECT isc.*, si.name as item_name, sm.name as module_name
       FROM imported_scores isc
       LEFT JOIN scoring_items si ON isc.item_id = si.id
       LEFT JOIN scoring_modules sm ON isc.module_id = sm.id
       WHERE isc.student_id = ? AND isc.academic_year_id = ?`,
      [student.id, yearId]
    );
    res.json({ importedScores: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==================== 辅导员查看班级成绩 ====================
exports.getClassScores = async (req, res) => {
  try {
    const teacher = await Teacher.findByUserId(req.user.userId);
    if (!teacher) return res.status(404).json({ error: '未找到教师信息' });

    const scope = await resolveManagedClassScope(pool, teacher);
    const classNames = scope.classNames;
    const teacherGrade = scope.grade;
    const yearId = await getCurrentYearId(req.query.yearId);
    if (classNames.length === 0) {
      return res.json({ className: '', classNames: [], yearId, rankings: [], message: '未配置负责班级，请联系管理员在教师管理中为辅导员分配班级' });
    }
    const allowedKeys = new Set(classNames.map(normalizeClassName));
    const allRankings = await Score.getRankings(yearId);
    const scopedRankings = allRankings.filter(item =>
      allowedKeys.has(normalizeClassName(item.className)) &&
      (!teacherGrade || normalizeGrade(item.grade) === normalizeGrade(teacherGrade))
    );

    if (!req.query.className) {
      return res.json({ className: '', classNames, yearId, rankings: scopedRankings });
    }

    const requested = String(req.query.className);
    const [className] = await canonicalizeClassNames(pool, [requested]);
    if (!allowedKeys.has(normalizeClassName(className))) {
      return res.status(403).json({ error: '无权查看该班级成绩' });
    }
    const rankings = scopedRankings.filter(item => normalizeClassName(item.className) === normalizeClassName(className));
    res.json({ className, classNames, yearId, rankings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 管理员查看全院实时排名，供新版管理端概览使用。
exports.getAllScores = async (req, res) => {
  try {
    const yearId = await getCurrentYearId(req.query.yearId);
    const rankings = await Score.getRankings(yearId);
    res.json({ yearId, rankings });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// ==================== 成绩导入 ====================
exports.importScores = async (req, res) => {
  try {
    const { scores, moduleId, itemId, yearId } = req.body;
    if (!scores || scores.length === 0 || !moduleId || !itemId) {
      return res.status(400).json({ error: '数据不完整' });
    }

    if (!Array.isArray(scores) || scores.length > 5000) {
      return res.status(400).json({ error: '单次最多导入 5000 条成绩' });
    }
    const parsedModuleId = parseInt(moduleId, 10);
    const parsedItemId = parseInt(itemId, 10);
    const [itemRows] = await pool.query(
      'SELECT id, module_id, max_score, requires_proof FROM scoring_items WHERE id = ? AND module_id = ?',
      [parsedItemId, parsedModuleId]
    );
    const item = itemRows[0];
    if (!item) return res.status(400).json({ error: '导入项目与所属板块不匹配' });
    if (item.requires_proof) return res.status(400).json({ error: '该项目需要材料审核，不能通过成绩表直接导入' });

    const isAdmin = req.user.role === 'admin';
    const teacher = isAdmin ? null : await Teacher.findByUserId(req.user.userId);
    const scope = isAdmin ? { classNames: [], grade: '' } : await resolveManagedClassScope(pool, teacher);
    if (!isAdmin && scope.classNames.length === 0) return res.status(403).json({ error: '未配置负责班级，无法导入成绩' });
    const allowedKeys = new Set(scope.classNames.map(normalizeClassName));
    const resolvedYearId = await getCurrentYearId(yearId);
    await assertYearNotLocked(resolvedYearId);
    const resolved = [];
    const invalidRows = [];
    for (const s of scores) {
      const score = Number(s.score);
      const [rows] = await pool.query(
        'SELECT id, class_name, grade FROM students WHERE student_id = ?',
        [String(s.studentId || '').trim()]
      );
      const student = rows[0];
      const inScope = isAdmin || (student &&
        allowedKeys.has(normalizeClassName(student.class_name)) &&
        (!scope.grade || normalizeGrade(student.grade) === normalizeGrade(scope.grade)));
      const validScore = Number.isFinite(score) && score >= 0 && score <= Number(item.max_score);
      if (!student || !inScope || !validScore) {
        invalidRows.push({
          studentId: s.studentId,
          reason: !student ? '学号不存在' : !inScope ? '不在负责范围' : `成绩应在 0-${item.max_score} 之间`,
        });
      } else {
        resolved.push({
          studentId: student.id,
          academicYearId: resolvedYearId,
          moduleId: parsedModuleId,
          itemId: parsedItemId,
          score,
        });
      }
    }

    if (invalidRows.length > 0) {
      return res.status(400).json({
        error: `有 ${invalidRows.length} 条成绩无法导入，请修正后重新提交`,
        invalidRows: invalidRows.slice(0, 20),
      });
    }

    const results = await Score.importScores(resolved, req.user.userId);
    await auditLog(req, 'scores.import', 'imported_scores', null, { count: results.length, moduleId, itemId, yearId });
    res.json({ count: results.length, message: '成功导入 ' + results.length + ' 条成绩' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
