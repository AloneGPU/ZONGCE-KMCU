const pool = require('../config/database');
const Teacher = require('../models/teacher');
const { canonicalizeClassNames } = require('../utils/className');
const auditLog = require('../utils/audit');

function normalizeGrade(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const short = text.match(/^(\d{2})级?$/);
  if (short) return `20${short[1]}级`;
  const full = text.match(/^(20\d{2})级?$/);
  if (full) return `${full[1]}级`;
  return text;
}

// 辅导员提交班级/年级变更申请
exports.createRequest = async (req, res) => {
  try {
    const { action, reason } = req.body;
    const requestType = String(req.body.request_type || req.body.requestType || 'class').trim();
    const rawClassName = String(req.body.class_name || req.body.className || '').trim();
    const grade = normalizeGrade(req.body.grade);

    const teacher = await Teacher.findByUserId(req.user.userId);
    if (!teacher) return res.status(404).json({ error: '未找到教师信息，请确认该账号已绑定教师工号' });

    if (requestType === 'grade') {
      if (!grade) return res.status(400).json({ error: '请输入要申请变更的年级' });
      if (String(teacher.grade || '').trim() === grade) return res.status(400).json({ error: '当前已经是该管理年级' });
      const [pending] = await pool.query(
        `SELECT id FROM class_change_requests
         WHERE teacher_id = ? AND request_type = 'grade' AND grade = ? AND status = 'pending' LIMIT 1`,
        [teacher.id, grade]
      );
      if (pending.length > 0) return res.status(409).json({ error: '相同年级变更申请正在等待管理员审核' });
      const [result] = await pool.query(
        `INSERT INTO class_change_requests (teacher_id, teacher_name, request_type, action, class_name, grade, reason)
         VALUES (?, ?, 'grade', 'change', '', ?, ?)`,
        [teacher.id, teacher.name, grade, reason || '辅导员申请变更管理年级']
      );
      await auditLog(req, 'classRequest.create', 'class_change_request', result.insertId, { requestType: 'grade', grade });
      return res.status(201).json({ id: result.insertId, message: '年级变更申请已提交，等待管理员审核' });
    }

    if (!['add', 'remove'].includes(action) || !rawClassName) {
      return res.status(400).json({ error: '请选择正确的操作和班级' });
    }
    const [className] = await canonicalizeClassNames(pool, [rawClassName]);

    const existing = action === 'add'
      ? await pool.query('SELECT * FROM teacher_classes WHERE teacher_id = ? AND class_name = ?', [teacher.id, className])
      : await pool.query('SELECT * FROM teacher_classes WHERE teacher_id = ? AND class_name = ?', [teacher.id, className]);

    if (action === 'add' && existing[0].length > 0) return res.status(400).json({ error: '该班级已存在' });
    if (action === 'remove' && existing[0].length === 0) return res.status(400).json({ error: '该班级不存在' });

    const [pending] = await pool.query(
      `SELECT id FROM class_change_requests
       WHERE teacher_id = ? AND request_type = 'class' AND action = ? AND class_name = ? AND status = 'pending' LIMIT 1`,
      [teacher.id, action, className]
    );
    if (pending.length > 0) return res.status(409).json({ error: '相同班级变更申请正在等待管理员审核' });

    const [result] = await pool.query(
      `INSERT INTO class_change_requests (teacher_id, teacher_name, request_type, action, class_name, reason)
       VALUES (?, ?, 'class', ?, ?, ?)`,
      [teacher.id, teacher.name, action, className, reason || '']
    );
    await auditLog(req, 'classRequest.create', 'class_change_request', result.insertId, { requestType: 'class', action, className });
    res.status(201).json({ id: result.insertId, message: '申请已提交，等待管理员审核' });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// 管理员查看待审批列表
exports.getRequests = async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM class_change_requests';
    if (status) sql += ' WHERE status = ?';
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const params = status ? [status] : [];
    const [rows] = await pool.query(sql, params);
    res.json({ requests: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// 管理员审批（通过/拒绝）
exports.reviewRequest = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { action } = req.body; // 'approve' | 'reject'
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '审批操作无效' });
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM class_change_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '申请不存在' });
    }
    const reqObj = rows[0];
    if (reqObj.status !== 'pending') {
      await conn.rollback();
      return res.status(400).json({ error: '该申请已被处理' });
    }
    const requestType = reqObj.request_type || 'class';

    if (action === 'approve') {
      if (requestType === 'grade') {
        const grade = normalizeGrade(reqObj.grade);
        if (!grade) {
          await conn.rollback();
          return res.status(400).json({ error: '申请缺少年级信息' });
        }
        await conn.query('UPDATE teachers SET grade = ? WHERE id = ?', [grade, reqObj.teacher_id]);
      } else {
        const [className] = await canonicalizeClassNames(pool, [reqObj.class_name]);
        const [tc] = await conn.query('SELECT * FROM teacher_classes WHERE teacher_id = ? AND class_name = ?', [reqObj.teacher_id, className]);
        if (reqObj.action === 'add') {
          if (tc.length === 0) await conn.query('INSERT INTO teacher_classes (teacher_id, class_name) VALUES (?, ?)', [reqObj.teacher_id, className]);
        } else {
          await conn.query('DELETE FROM teacher_classes WHERE teacher_id = ? AND class_name = ?', [reqObj.teacher_id, className]);
        }
      }
    }

    await conn.query('UPDATE class_change_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
      [action === 'approve' ? 'approved' : 'rejected', req.user.userId, req.params.id]);
    await conn.commit();
    await auditLog(req, 'classRequest.review', 'class_change_request', req.params.id, { action, requestType });
    res.json({ message: action === 'approve' ? (requestType === 'grade' ? '已通过，管理年级已更新' : '已通过，班级已更新') : '已拒绝' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
};
