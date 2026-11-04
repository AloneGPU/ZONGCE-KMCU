const Submission = require('../models/submission');
const Student = require('../models/student');
const Teacher = require('../models/teacher');
const Score = require('../models/score');
const pool = require('../config/database');
const { getCurrentYearId } = require('../utils/year');
const auditLog = require('../utils/audit');
const { resolveManagedClassScope, canonicalizeClassNames, normalizeClassName, normalizeGrade } = require('../utils/className');
const { assignPendingForClass } = require('../utils/reviewAssignment');
const { getProofFiles, serializeProofFiles } = require('../utils/proofFiles');
const { assignDenseRanks } = require('../utils/ranking');

function cleanupIncomingFiles(files) {
  for (const file of Array.isArray(files) ? files : [files]) {
    if (!file || !file.path) continue;
    try {
      require('fs').unlinkSync(file.path);
    } catch (e) { /* ignore cleanup errors */ }
  }
}

function cleanupStoredProofFiles(submission) {
  const { deleteStoredFile } = require('../utils/upload');
  for (const file of getProofFiles(submission)) {
    try {
      deleteStoredFile(file.path);
    } catch (cleanupErr) {
      console.error('材料图片清理失败:', cleanupErr.message);
    }
  }
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

async function assertSubmissionDeadline(yearId) {
  const [rows] = await pool.query(
    'SELECT deadline FROM academic_years WHERE id = ? AND deadline IS NOT NULL AND deadline < CURDATE()',
    [yearId]
  );
  if (rows.length > 0) {
    const error = new Error(`该学年的材料提交截止日为 ${rows[0].deadline instanceof Date ? rows[0].deadline.toISOString().slice(0, 10) : String(rows[0].deadline).slice(0, 10)}，当前已超过截止时间，不能继续提交`);
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
    let hasExtraScope = false;
    if (!sameClass || !sameGrade) {
      const [scopeRows] = await pool.query(
        'SELECT id FROM assistant_review_scopes WHERE user_id = ? AND class_name = ? AND grade = ? LIMIT 1',
        [req.user.userId, submission.class_name, submission.grade]
      );
      hasExtraScope = scopeRows.length > 0;
    }
    if ((!sameClass || !sameGrade) && !hasExtraScope) {
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

  if (req.user.role === 'admin' || req.user.role === 'college_admin') {
    if (req.user.role === 'college_admin' && Number(req.user.collegeId) !== Number(submission.college_id)) {
      const error = new Error('无权审核其他学院的材料');
      error.statusCode = 403;
      throw error;
    }
    return 'admin';
  }

  const error = new Error('当前角色不参与材料审核');
  error.statusCode = 403;
  throw error;
}

// ==================== 学生提交材料 ====================
exports.create = async (req, res) => {
  let finalizedProofPaths = [];
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) {
      cleanupIncomingFiles(req.files);
      return res.status(404).json({ error: '未找到学生信息' });
    }

    const { moduleId, itemId } = req.body;
    const description = String(req.body.description || '无').trim() || '无';
    const awardMonth = String(req.body.award_month || req.body.awardMonth || '').trim();
    let academicYearId = req.body.academicYearId;
    if (!moduleId || !itemId) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '请选择加分项' });
    }
    if (awardMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(awardMonth)) {
      cleanupIncomingFiles(req.files);
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
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '该加分项不存在' });
    }
    const item = itemRows[0];
    if (!item.requires_proof || item.requires_proof === 0) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '此项为考试成绩类，由教师统一导入，学生无需提交' });
    }

    // 使用规则表中预设的固定分值，支持次数倍增
    const rawCount = req.body.count === undefined || req.body.count === '' ? 1 : Number(req.body.count);
    if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > 100) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '申报次数必须是 1 至 100 的整数' });
    }
    const count = rawCount;
    const submittedScore = (parseFloat(item.max_score) || 0) * count;
    if (submittedScore <= 0) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '该加分项未配置分值，请联系管理员' });
    }

    // 获取学年名
    const yearId = await getCurrentYearId(academicYearId);
    await assertYearNotLocked(yearId);
    await assertSubmissionDeadline(yearId);
    const [yearRows] = await pool.query('SELECT name FROM academic_years WHERE id = ?', [yearId]);
    const yearName = yearRows[0] ? yearRows[0].name : 'unknown';

    // 处理上传图片。最终文件名由服务端根据学生、加分模块和分值生成，避免前端伪造。
    const files = Array.isArray(req.files) ? req.files : [];
    const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (files.length === 0) {
      return res.status(400).json({ error: '请上传证明图片，仅支持 JPG/PNG/GIF，大小不超过 10MB' });
    }
    if (files.length > 10) {
      cleanupIncomingFiles(files);
      return res.status(400).json({ error: '单次最多上传 10 张图片' });
    }
    if (totalSize > 10 * 1024 * 1024) {
      cleanupIncomingFiles(files);
      return res.status(400).json({ error: '图片总大小不能超过 10MB' });
    }
    const studentProofName = String(req.body.proof_name || '').trim();
    if (!studentProofName) {
      cleanupIncomingFiles(files);
      return res.status(400).json({ error: '请填写证明图片名称' });
    }

    const path = require('path');
    const fs = require('fs');
    const { moveToFinalDir, validateMagicNumber, sanitizeFilePart, getUploadRoot } = require('../utils/upload');
    const extByMime = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' };
    const customName = sanitizeFilePart(path.basename(studentProofName, path.extname(studentProofName)), '证明材料');
    const moduleLabel = String(item.module_name || '加分项').endsWith('类') ? item.module_name : `${item.module_name || '加分项'}类`;
    const scoreText = Number.isInteger(submittedScore) ? String(submittedScore) : submittedScore.toFixed(1).replace(/\.0$/, '');
    const proofFiles = [];
    for (const [index, file] of files.entries()) {
      const ext = extByMime[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.jpg';
      const suffix = files.length > 1 ? `_${index + 1}` : '';
      const finalFilename = [
        sanitizeFilePart(student.student_id, '学号'),
        sanitizeFilePart(student.name, '姓名'),
        sanitizeFilePart(moduleLabel, '加分类'),
        sanitizeFilePart(`${scoreText}分`, '分值'),
        customName + suffix
      ].join('_') + ext;
      const moved = moveToFinalDir(file.filename, yearName, student.student_id, finalFilename);
      const fullPath = path.join(getUploadRoot(), moved.proofPath);
      if (!validateMagicNumber(fullPath, file.mimetype)) {
        fs.unlinkSync(fullPath);
        cleanupStoredProofFiles({ proofFiles: serializeProofFiles(proofFiles) });
        finalizedProofPaths = [];
        return res.status(400).json({ error: '文件类型与实际内容不符，请上传真实图片' });
      }
      proofFiles.push({ path: moved.proofPath, filename: moved.filename });
      finalizedProofPaths.push(moved.proofPath);
    }
    const proofFilename = proofFiles[0].filename;
    const proofPath = proofFiles[0].path;

    const sub = await Submission.create({
      studentId: student.id,
      academicYearId: yearId,
      moduleId, itemId,
      score: submittedScore,
      description,
      awardMonth,
      proofFilename,
      proofPath,
      proofFiles: serializeProofFiles(proofFiles),
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
    finalizedProofPaths = [];
    res.status(201).json({ submission: sub });
  } catch (err) {
    cleanupIncomingFiles(req.files);
    for (const proofPath of finalizedProofPaths) {
      try {
        require('../utils/upload').deleteStoredFile(proofPath);
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

async function buildProofFilesFromUpload({ files, proofName, yearName, student, moduleName, score, oldProofFiles = [] }) {
  const path = require('path');
  const fs = require('fs');
  const { moveToFinalDir, validateMagicNumber, sanitizeFilePart, getUploadRoot } = require('../utils/upload');
  const extByMime = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/gif': '.gif' };
  const finalizedProofPaths = [];
  const proofFiles = [];

  if (!Array.isArray(files) || files.length === 0) {
    return { proofFiles: oldProofFiles, finalizedProofPaths };
  }
  if (files.length > 10) {
    cleanupIncomingFiles(files);
    const error = new Error('单次最多上传 10 张图片');
    error.statusCode = 400;
    throw error;
  }
  const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  if (totalSize > 10 * 1024 * 1024) {
    cleanupIncomingFiles(files);
    const error = new Error('图片总大小不能超过 10MB');
    error.statusCode = 400;
    throw error;
  }
  const studentProofName = String(proofName || '').trim();
  if (!studentProofName) {
    cleanupIncomingFiles(files);
    const error = new Error('请填写证明图片名称');
    error.statusCode = 400;
    throw error;
  }

  const customName = sanitizeFilePart(path.basename(studentProofName, path.extname(studentProofName)), '证明材料');
  const moduleLabel = String(moduleName || '加分项').endsWith('类') ? moduleName : `${moduleName || '加分项'}类`;
  const scoreText = Number.isInteger(score) ? String(score) : String(score);
  for (const [index, file] of files.entries()) {
    const ext = extByMime[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.jpg';
    const suffix = files.length > 1 ? `_${index + 1}` : '';
    const finalFilename = [
      sanitizeFilePart(student.student_id, '学号'),
      sanitizeFilePart(student.name, '姓名'),
      sanitizeFilePart(moduleLabel, '加分类'),
      sanitizeFilePart(`${scoreText}分`, '分值'),
      customName + suffix
    ].join('_') + ext;
    const moved = moveToFinalDir(file.filename, yearName, student.student_id, finalFilename);
    const fullPath = path.join(getUploadRoot(), moved.proofPath);
    if (!validateMagicNumber(fullPath, file.mimetype)) {
      fs.unlinkSync(fullPath);
      cleanupStoredProofFiles({ proof_files: serializeProofFiles(proofFiles) });
      const error = new Error('文件类型与实际内容不符，请上传真实图片');
      error.statusCode = 400;
      throw error;
    }
    proofFiles.push({ path: moved.proofPath, filename: moved.filename });
    finalizedProofPaths.push(moved.proofPath);
  }
  return { proofFiles, finalizedProofPaths };
}

exports.updateMySubmission = async (req, res) => {
  let finalizedProofPaths = [];
  try {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) return res.status(404).json({ error: '未找到学生信息' });

    // 只允许改本人材料：不存在或非本人的记录一律 404
    const sub = await Submission.findByIdForStudent(req.params.id, student.id);
    if (!sub) return res.status(404).json({ error: '提交记录不存在' });
    await assertYearNotLocked(sub.academic_year_id);
    if (sub.status !== 'rejected') {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '只能修改被驳回的提交' });
    }

    const description = String(req.body.description || '无').trim() || '无';
    const awardMonth = req.body.award_month !== undefined || req.body.awardMonth !== undefined
      ? String(req.body.award_month || req.body.awardMonth || '').trim()
      : undefined;
    if (awardMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(awardMonth)) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '奖项获得时间格式不正确，请选择到月份' });
    }

    const nextModuleId = req.body.moduleId || req.body.module_id || sub.module_id;
    const nextItemId = req.body.itemId || req.body.item_id || sub.item_id;
    const [itemRows] = await pool.query(
      `SELECT si.*, sm.name as module_name
       FROM scoring_items si
       JOIN scoring_modules sm ON si.module_id = sm.id
       WHERE si.id = ? AND si.module_id = ?`,
      [nextItemId, nextModuleId]
    );
    if (itemRows.length === 0) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '该加分项不存在' });
    }
    const item = itemRows[0];
    if (!item.requires_proof || item.requires_proof === 0) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '此项为考试成绩类，由教师统一导入，学生无需提交' });
    }
    const rawCount = req.body.count === undefined || req.body.count === '' ? 1 : Number(req.body.count);
    if (!Number.isInteger(rawCount) || rawCount < 1 || rawCount > 100) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '申报次数必须是 1 至 100 的整数' });
    }
    const nextScore = (parseFloat(item.max_score) || 0) * rawCount;
    if (nextScore <= 0) {
      cleanupIncomingFiles(req.files);
      return res.status(400).json({ error: '该加分项未配置分值，请联系管理员' });
    }

    const yearId = await getCurrentYearId(sub.academic_year_id);
    await assertSubmissionDeadline(yearId);
    const [yearRows] = await pool.query('SELECT name FROM academic_years WHERE id = ?', [yearId]);
    const yearName = yearRows[0] ? yearRows[0].name : 'unknown';
    const files = Array.isArray(req.files) ? req.files : [];
    const oldProofFiles = getProofFiles(sub);
    const proofResult = await buildProofFilesFromUpload({
      files,
      proofName: req.body.proof_name,
      yearName,
      student,
      moduleName: item.module_name,
      score: nextScore,
      oldProofFiles,
    });
    finalizedProofPaths = proofResult.finalizedProofPaths;

    const updates = {
      module_id: nextModuleId,
      item_id: nextItemId,
      score: nextScore,
      description,
      status: 'pending',
      rejection_reason: null,
      assistant_assignee_id: null,
      assistant_reviewer_id: null,
      assistant_review_at: null,
      counselor_reviewer_id: null,
      counselor_review_at: null,
    };
    if (awardMonth !== undefined) updates.award_month = awardMonth || null;
    if (files.length > 0) {
      updates.proof_filename = proofResult.proofFiles[0].filename;
      updates.proof_path = proofResult.proofFiles[0].path;
      updates.proof_files = serializeProofFiles(proofResult.proofFiles);
    }

    const affectedRows = await Submission.update(req.params.id, updates, ['rejected']);
    if (affectedRows !== 1) {
      const error = new Error('材料状态已变化，请刷新后重试');
      error.statusCode = 409;
      throw error;
    }
    if (files.length > 0) cleanupStoredProofFiles({ proof_files: serializeProofFiles(oldProofFiles) });
    try {
      await assignPendingForClass(student.class_name, student.grade);
    } catch (assignErr) {
      console.error('材料重新提交后的班委评审任务分配失败:', assignErr.message);
    }
    await auditLog(req, 'submission.update', 'submission', req.params.id, {
      description,
      awardMonth,
      moduleId: nextModuleId,
      itemId: nextItemId,
      score: nextScore,
      replacedProofs: files.length > 0,
    });
    finalizedProofPaths = [];
    res.json({ message: '已更新，已重新提交审核' });
  } catch (err) {
    cleanupIncomingFiles(req.files);
    for (const proofPath of finalizedProofPaths) {
      try {
        require('../utils/upload').deleteStoredFile(proofPath);
      } catch (cleanupErr) {
        console.error('修改失败后的材料文件清理失败:', cleanupErr.message);
      }
    }
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
    cleanupStoredProofFiles(sub);
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
    if (req.user.role === 'college_admin' && Number(sub.college_id) !== Number(req.user.collegeId)) {
      return res.status(403).json({ error: '只能删除本学院的材料' });
    }
    await assertYearNotLocked(sub.academic_year_id);

    await Submission.delete(sub.id);
    cleanupStoredProofFiles(sub);
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
    cleanupStoredProofFiles(sub);
    await auditLog(req, 'submission.counselor_delete', 'submission', sub.id, {
      studentId: sub.student_id, status: sub.status,
    });
    res.json({ message: '已删除该材料，成绩将随之重新计算' });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

async function assertCanDeleteSubmission(req, sub, counselorScope) {
  if (!sub) return { ok: false, reason: '提交记录不存在' };
  try {
    await assertYearNotLocked(sub.academic_year_id);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  if (req.user.role === 'admin') return { ok: true };
  if (req.user.role === 'college_admin') {
    return Number(sub.college_id) === Number(req.user.collegeId)
      ? { ok: true }
      : { ok: false, reason: '该材料不属于当前学院' };
  }

  if (req.user.role !== 'counselor') return { ok: false, reason: '无权删除材料' };
  if (!counselorScope || counselorScope.classNames.length === 0) {
    return { ok: false, reason: '未配置负责班级，无权删除材料' };
  }

  const allowed = counselorScope.classNames.some(item => (
    normalizeClassName(item) === normalizeClassName(sub.class_name) &&
      (!counselorScope.grade || normalizeGrade(counselorScope.grade) === normalizeGrade(sub.grade))
  ));
  return allowed ? { ok: true } : { ok: false, reason: '该材料不属于当前负责的班级' };
}

// ==================== 管理员/辅导员批量删除材料 ====================
exports.batchDeleteSubmissions = async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? Array.from(new Set(req.body.ids.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0)))
      : [];
    if (ids.length === 0) return res.status(400).json({ error: '请选择要删除的材料' });
    if (ids.length > 500) return res.status(400).json({ error: '单次最多批量删除 500 条材料' });

    let counselorScope = null;
    if (req.user.role === 'counselor') {
      const teacher = await Teacher.findByUserId(req.user.userId);
      if (!teacher) return res.status(404).json({ error: '未找到教师信息' });
      counselorScope = await resolveManagedClassScope(pool, teacher);
    }

    const deleted = [];
    const skipped = [];
    for (const id of ids) {
      const sub = await Submission.findById(id);
      const access = await assertCanDeleteSubmission(req, sub, counselorScope);
      if (!access.ok) {
        skipped.push({ id, reason: access.reason });
        continue;
      }

      await Submission.delete(id);
      cleanupStoredProofFiles(sub);
      deleted.push(id);
    }

    await auditLog(req, 'submission.batch_delete', 'submission', null, {
      requested: ids.length,
      deleted: deleted.length,
      skipped: skipped.length,
      role: req.user.role,
    });
    res.json({
      deletedCount: deleted.length,
      skippedCount: skipped.length,
      skipped: skipped.slice(0, 20),
      message: `已删除 ${deleted.length} 条材料${skipped.length ? `，跳过 ${skipped.length} 条` : ''}`,
    });
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

    if (role === 'admin' || role === 'college_admin') {
      subs = await Submission.findByYear(yearIdNum);
      if (role === 'college_admin') subs = subs.filter(item => Number(item.college_id) === Number(req.user.collegeId));
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
      const [scopes] = await pool.query('SELECT class_name, grade FROM assistant_review_scopes WHERE user_id = ?', [req.user.userId]);
      for (const scope of scopes) {
        await assignPendingForClass(scope.class_name, scope.grade);
        const extra = await Submission.findPendingByClass(scope.class_name, yearIdNum, scope.grade, req.user.userId);
        subs = subs.concat(extra);
      }
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
      if (role === 'admin' || role === 'college_admin') {
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
    const { action, reason, score } = req.body; // 'approve' | 'reject'
    const subId = req.params.id;

    const submission = await Submission.findById(subId);
    await assertYearNotLocked(submission.academic_year_id);
      const reviewerRole = await assertCanReviewSubmission(req, submission);

    if (action === 'approve') {
      const approved = await Submission.approve(subId, reviewerRole, req.user.userId, score);
      await auditLog(req, 'submission.approve', 'submission', subId, { status: approved.status, score: approved.score });
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
      const breakdown = await Score.calcModuleBreakdown(student.id, yearId, mod.id);
      const modItems = itemRows.filter(i => i.module_id === mod.id);
      const baseScore = Score.moduleBaseScore(mod.id);
      const finalScore = breakdown.total + baseScore;
      moduleScores.push({
        ...mod,
        score: breakdown.total,
        approvedScore: breakdown.approvedScore,
        importedScore: breakdown.importedScore,
        baseScore,
        finalScore,
        weightedScore: Score.calculateWeightedScore(finalScore, mod.weight),
        items: modItems,
      });
    }

    const totalScore = await Score.calcTotalScore(student.id, yearId);
    const rankings = await Score.getRankings(yearId, student.class_name, student.grade, student.college_id);
    const myRank = rankings.find(r => r.studentId == student.id);
    const gradeRankings = await Score.getRankings(yearId, null, student.grade, student.college_id);
    assignDenseRanks(gradeRankings, 'totalScore', 'gradeRank', row => row.studentCode);
    const myGradeRank = gradeRankings.find(r => r.studentId == student.id);
    const moduleRankById = new Map((myRank?.modules || []).map(module => [Number(module.moduleId), module.rank]));
    moduleScores.forEach(module => {
      module.rank = moduleRankById.get(Number(module.id)) ?? null;
    });

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
      gradeRank: myGradeRank ? myGradeRank.gradeRank : null,
      totalInGrade: gradeRankings.length,
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

    if (req.query.className) {
      const requested = String(req.query.className);
      const [className] = await canonicalizeClassNames(pool, [requested]);
      if (!allowedKeys.has(normalizeClassName(className))) {
        return res.status(403).json({ error: '无权查看该班级成绩' });
      }
      const rankings = await Score.getRankings(yearId, className, teacherGrade);
      return res.json({ className, classNames, yearId, rankings });
    }

    // Each class is ranked independently, including all six module rankings.
    // Combining the results only affects display order, never the rank values.
    const rankingGroups = await Promise.all(classNames.map(className =>
      Score.getRankings(yearId, className, teacherGrade)
    ));
    const rankings = rankingGroups
      .flat()
      .sort((a, b) => b.totalScore - a.totalScore || String(a.studentCode).localeCompare(String(b.studentCode), 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));
    res.json({ className: '', classNames, yearId, rankings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 管理员查看全院实时排名，供新版管理端概览使用。
exports.getAllScores = async (req, res) => {
  try {
    const yearId = await getCurrentYearId(req.query.yearId);
    const rankings = await Score.getRankings(yearId, undefined, undefined, req.user.role === 'college_admin' ? req.user.collegeId : null);
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
      `SELECT si.id, si.module_id, si.max_score, si.requires_proof, sm.name AS module_name
       FROM scoring_items si
       JOIN scoring_modules sm ON sm.id = si.module_id
       WHERE si.id = ? AND si.module_id = ?`,
      [parsedItemId, parsedModuleId]
    );
    const item = itemRows[0];
    if (!item) return res.status(400).json({ error: '导入项目与所属板块不匹配' });
    if (![2, 3].includes(Number(item.module_id))) {
      return res.status(400).json({ error: '基础成绩批量导入仅支持智育和体育。德育扣分请使用“德育扣分批量导入”。' });
    }
    if (item.requires_proof) return res.status(400).json({ error: '该项目需要材料审核，不能通过成绩表直接导入' });

    const isAdmin = req.user.role === 'admin';
    const isCollegeAdmin = req.user.role === 'college_admin';
    const teacher = isAdmin || isCollegeAdmin ? null : await Teacher.findByUserId(req.user.userId);
    const scope = isAdmin || isCollegeAdmin ? { classNames: [], grade: '' } : await resolveManagedClassScope(pool, teacher);
    if (!isAdmin && !isCollegeAdmin && scope.classNames.length === 0) return res.status(403).json({ error: '未配置负责班级，无法导入成绩' });
    const allowedKeys = new Set(scope.classNames.map(normalizeClassName));
    const resolvedYearId = await getCurrentYearId(yearId);
    await assertYearNotLocked(resolvedYearId);
    const resolved = [];
    const invalidRows = [];
    for (const s of scores) {
      const score = Number(s.score);
      const [rows] = await pool.query(
        'SELECT id, class_name, grade, college_id FROM students WHERE student_id = ?',
        [String(s.studentId || '').trim()]
      );
      const student = rows[0];
      const inScope = isAdmin || (isCollegeAdmin ? Number(student?.college_id) === Number(req.user.collegeId) : (student &&
        allowedKeys.has(normalizeClassName(student.class_name)) &&
        (!scope.grade || normalizeGrade(student.grade) === normalizeGrade(scope.grade))));
      const maxScore = parsedModuleId === 3 ? Math.min(60, Number(item.max_score)) : Number(item.max_score);
      const validScore = Number.isFinite(score) && score >= 0 && score <= maxScore;
      if (!student || !inScope || !validScore) {
        invalidRows.push({
          studentId: s.studentId,
          reason: !student ? '学号不存在' : !inScope ? '不在负责范围' : `成绩应在 0-${maxScore} 之间`,
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

// ==================== 德育扣分批量导入 ====================
exports.importMoralDeductions = async (req, res) => {
  try {
    const { deductions, yearId } = req.body;
    if (!Array.isArray(deductions) || deductions.length === 0) {
      return res.status(400).json({ error: '请提供要导入的德育扣分记录' });
    }
    if (deductions.length > 5000) return res.status(400).json({ error: '单次最多导入 5000 条扣分记录' });

    const resolvedYearId = await getCurrentYearId(yearId);
    await assertYearNotLocked(resolvedYearId);

    const [deductionItems] = await pool.query(
      `SELECT si.id, si.module_id, si.name, si.max_score
       FROM scoring_items si
       JOIN scoring_modules sm ON sm.id = si.module_id
       WHERE sm.name = '德育' AND si.requires_proof = FALSE AND si.max_score < 0`
    );
    const itemMap = new Map(deductionItems.map(item => [Number(item.id), item]));
    if (itemMap.size === 0) return res.status(400).json({ error: '当前规则中没有可批量导入的德育扣分项' });

    const isAdmin = req.user.role === 'admin';
    const isCollegeAdmin = req.user.role === 'college_admin';
    const teacher = isAdmin || isCollegeAdmin ? null : await Teacher.findByUserId(req.user.userId);
    const scope = isAdmin || isCollegeAdmin ? { classNames: [], grade: '' } : await resolveManagedClassScope(pool, teacher);
    if (!isAdmin && !isCollegeAdmin && (!scope || scope.classNames.length === 0)) {
      return res.status(403).json({ error: '未配置负责班级，无法导入德育扣分' });
    }
    const allowedKeys = new Set((scope.classNames || []).map(normalizeClassName));

    const invalidRows = [];
    const grouped = new Map();
    for (const row of deductions) {
      const studentCode = String(row.studentId || '').trim();
      const itemId = parseInt(row.itemId, 10);
      const item = itemMap.get(itemId);
      const count = row.count === undefined || row.count === '' ? 1 : Number(row.count);
      const manualScore = row.score === undefined || row.score === '' ? null : Number(row.score);

      const [students] = await pool.query(
        'SELECT id, student_id, name, class_name, grade, college_id FROM students WHERE student_id = ?',
        [studentCode]
      );
      const student = students[0];
      const inScope = isAdmin || (isCollegeAdmin ? Number(student?.college_id) === Number(req.user.collegeId) : (student &&
        allowedKeys.has(normalizeClassName(student.class_name)) &&
        (!scope.grade || normalizeGrade(scope.grade) === normalizeGrade(student.grade))));

      let score = Number(item && item.max_score);
      if (Number.isFinite(manualScore)) {
        score = manualScore > 0 ? -manualScore : manualScore;
      } else if (Number.isInteger(count) && count >= 1 && count <= 100 && item) {
        score = Number(item.max_score) * count;
      }

      const minScore = item ? Number(item.max_score) * 100 : 0;
      const validScore = item && Number.isFinite(score) && score < 0 && score >= minScore;
      if (!student || !item || !inScope || !validScore) {
        invalidRows.push({
          studentId: studentCode,
          itemId: row.itemId,
          reason: !student ? '学号不存在' : !item ? '扣分项不存在或不是德育扣分项' : !inScope ? '不在负责范围' : '扣分值无效',
        });
        continue;
      }

      const key = `${student.id}:${item.id}`;
      const current = grouped.get(key) || {
        studentId: student.id,
        studentCode: student.student_id,
        studentName: student.name,
        academicYearId: resolvedYearId,
        moduleId: Number(item.module_id || 1),
        itemId: item.id,
        itemName: item.name,
        score: 0,
      };
      current.score += score;
      grouped.set(key, current);
    }

    if (invalidRows.length > 0) {
      return res.status(400).json({
        error: `有 ${invalidRows.length} 条德育扣分无法导入，请修正后重新提交`,
        invalidRows: invalidRows.slice(0, 20),
      });
    }

    const rows = Array.from(grouped.values());
    const results = await Score.importScores(rows, req.user.userId);
    const byItem = rows.reduce((acc, row) => {
      const key = row.itemName;
      const current = acc[key] || { itemName: key, count: 0, total: 0 };
      current.count += 1;
      current.total += row.score;
      acc[key] = current;
      return acc;
    }, {});
    const totalDeduction = rows.reduce((sum, row) => sum + row.score, 0);

    await auditLog(req, 'scores.import_moral_deductions', 'imported_scores', null, {
      count: results.length,
      totalDeduction,
      yearId: resolvedYearId,
    });
    res.json({
      count: results.length,
      totalDeduction,
      byItem: Object.values(byItem),
      message: `成功导入 ${results.length} 条德育扣分，合计扣 ${Math.abs(totalDeduction)} 分`,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};
