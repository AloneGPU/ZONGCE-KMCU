/**
 * 文件下载 / PDF 导出接口
 * 所有文件访问都要经过 API 权限校验
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const authenticate = require('../middleware/auth');
const pool = require('../config/database');
const Teacher = require('../models/teacher');
const Student = require('../models/student');
const Score = require('../models/score');
const { getCurrentYearId } = require('../utils/year');
const { escapeHtml } = require('../utils/html');
const { getUploadRoot } = require('../utils/upload');
const { getProofFiles } = require('../utils/proofFiles');
const { normalizeClassName, normalizeGrade, resolveManagedClassScope } = require('../utils/className');

async function canAccessStudent(req, studentId, submission) {
  if (req.user.role === 'admin') return true;
  if (req.user.role === 'college_admin') {
    const target = await Student.findById(studentId);
    return !!target && Number(target.college_id) === Number(req.user.collegeId);
  }

  if (req.user.role === 'student' || req.user.role === 'assistant') {
    const student = await Student.findByUserId(req.user.userId);
    if (!student) return false;
    // 班委只能查看自己的材料或系统分配给自己的评审材料。
    if (student.is_assistant) {
      const target = await Student.findById(studentId);
      if (!target) return false;
      if (student.id === Number(studentId)) return true;
      return !!submission && Number(submission.assistant_assignee_id) === Number(req.user.userId) &&
        normalizeClassName(target.class_name) === normalizeClassName(student.class_name) &&
        normalizeGrade(target.grade) === normalizeGrade(student.grade);
    }
    // 普通学生只能看自己的
    return student.id === Number(studentId);
  }

  if (req.user.role === 'counselor') {
    const teacher = await Teacher.findByUserId(req.user.userId);
    if (!teacher) return false;
    const target = await Student.findById(studentId);
    const scope = await resolveManagedClassScope(pool, teacher);
    return !!target &&
      scope.classNames.some(item => normalizeClassName(item) === normalizeClassName(target.class_name)) &&
      (!scope.grade || normalizeGrade(target.grade) === normalizeGrade(scope.grade));
  }

  return false;
}

// 文件接口支持 URL query token（window.open 新标签不支持 Authorization header）
function tokenFromQuery(req, res, next) {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
}

// ==================== 下载证明材料 ====================
// GET /api/files/proof/:submissionId?token=xxx
router.get('/proof/:submissionId/:fileIndex?', tokenFromQuery, authenticate, async (req, res) => {
  try {
    const subId = req.params.submissionId;
    const [rows] = await pool.query(
      'SELECT * FROM submissions WHERE id = ?', [subId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '提交记录不存在' });
    }

    const sub = rows[0];

    if (!(await canAccessStudent(req, sub.student_id, sub))) {
      return res.status(403).json({ error: '无权查看此文件' });
    }

    const proofFiles = getProofFiles(sub);
    const fileIndex = req.params.fileIndex === undefined ? 0 : parseInt(req.params.fileIndex, 10);
    const proof = proofFiles[fileIndex];
    if (!proof) {
      return res.status(404).json({ error: '该提交没有证明材料' });
    }

    // 文件存储的相对路径转绝对路径
    const uploadRoot = getUploadRoot();
    const filePath = path.resolve(uploadRoot, proof.path);
    if (!filePath.startsWith(uploadRoot + path.sep)) {
      return res.status(400).json({ error: '文件路径非法' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '证明材料文件不存在，可能已被删除' });
    }

    // 根据文件类型决定内联预览还是下载，显式设置 Content-Type
    const ext = path.extname(proof.filename || '').toLowerCase();
    const mimeMap = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    const mimeType = mimeMap[ext] || 'application/octet-stream';
    const inlineTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.gif'];
    const disposition = inlineTypes.includes(ext) ? 'inline' : 'attachment';
    const rawName = proof.filename || 'file';
    const encodedName = encodeURIComponent(rawName);
    const asciiFallbackName = rawName
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '')
      .replace(/\s+/g, '_') || 'file';

    res.setHeader('Content-Type', mimeType);
    // 同时提供 filename（ASCII 回退）和 filename*（RFC 5987 UTF-8），确保所有浏览器兼容
    res.setHeader('Content-Disposition', `${disposition}; filename="${asciiFallbackName}"; filename*=UTF-8''${encodedName}`);
    res.sendFile(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== 导出学生个人材料 PDF ====================
// GET /api/files/export-pdf/:studentId?yearId=2&token=xxx
router.get('/export-pdf/:studentId', tokenFromQuery, authenticate, async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const yearId = await getCurrentYearId(req.query.yearId);

    if (!(await canAccessStudent(req, studentId))) {
      return res.status(403).json({ error: '无权导出该学生报告' });
    }

    // 获取学生信息
    const [students] = await pool.query(
      `SELECT s.*, c.name as college_name, ay.name as year_name
       FROM students s
       LEFT JOIN colleges c ON s.college_id = c.id
       LEFT JOIN academic_years ay ON ay.id = ?
       WHERE s.id = ?`, [yearId, studentId]
    );
    if (students.length === 0) return res.status(404).json({ error: '学生不存在' });
    const student = students[0];

    // 获取该学年所有提交
    const [subs] = await pool.query(
      `SELECT sub.*, sm.name as module_name, si.name as item_name, si.max_score
       FROM submissions sub
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN scoring_items si ON sub.item_id = si.id
       WHERE sub.student_id = ? AND sub.academic_year_id = ?
       ORDER BY sm.sort_order, sub.submit_at`, [studentId, yearId]
    );

    // 获取导入成绩
    const [imported] = await pool.query(
      `SELECT isc.*, sm.name as module_name, si.name as item_name
       FROM imported_scores isc
       LEFT JOIN scoring_modules sm ON isc.module_id = sm.id
       LEFT JOIN scoring_items si ON isc.item_id = si.id
       WHERE isc.student_id = ? AND isc.academic_year_id = ?`, [studentId, yearId]
    );

    // 计算总分
    const totalScore = await Score.calcTotalScore(studentId, yearId);
    const rankings = await Score.getRankings(yearId, student.class_name, student.grade);
    const myRank = rankings.find(r => r.studentId == studentId);

    // 生成一份 HTML 报告，浏览器可直接打印/导出 PDF
    const statusLabels = { pending: '待审核', assistant_approved: '班委已审', approved: '已通过', rejected: '已拒绝' };
    const statusColors = { pending: '#fb923c', assistant_approved: '#60a5fa', approved: '#4ade80', rejected: '#f87171' };

    const subsHtml = subs.length === 0
      ? '<p style="color:#999;text-align:center;padding:40px">暂无加分材料提交</p>'
      : subs.map(s => `
        <tr>
          <td>${escapeHtml(s.module_name || '-')}</td>
          <td>${escapeHtml(s.item_name || '-')}</td>
          <td style="color:#c9a84c">${s.score}</td>
          <td style="text-align:center"><span style="background:${statusColors[s.status]};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${statusLabels[s.status] || s.status}</span></td>
          <td>${escapeHtml(s.award_month || '-')}</td>
          <td>${escapeHtml(s.description || '-')}</td>
          <td>${escapeHtml(s.proof_filename || '-')}</td>
        </tr>
      `).join('');

    const importedHtml = imported.length === 0
      ? '<p style="color:#999;text-align:center">无导入成绩</p>'
      : imported.map(s => `
        <tr>
          <td>${escapeHtml(s.module_name || '-')}</td>
          <td>${escapeHtml(s.item_name || '-')}</td>
          <td style="color:#c9a84c">${s.score}</td>
        </tr>
      `).join('');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(student.name)} - 综测材料报告</title>
<style>
  body{font-family:'Microsoft YaHei',sans-serif;max-width:800px;margin:0 auto;padding:30px;color:#333}
  h1{text-align:center;color:#c9a84c;border-bottom:2px solid #c9a84c;padding-bottom:12px;margin-bottom:8px}
  .subtitle{text-align:center;color:#999;font-size:13px;margin-bottom:24px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#f8f8f8;padding:16px;border-radius:8px;margin-bottom:24px}
  .info-item{font-size:14px}
  .info-item span{color:#666}
  .score-box{text-align:center;background:linear-gradient(135deg,#faf5e6,#fdf8f0);border:1px solid #c9a84c;border-radius:12px;padding:20px;margin:20px 0}
  .score-box .total{font-size:48px;font-weight:700;color:#c9a84c}
  .score-box .rank{font-size:14px;color:#666;margin-top:6px}
  h2{color:#333;border-left:3px solid #c9a84c;padding-left:10px;margin-top:28px}
  table{width:100%;border-collapse:collapse;margin:12px 0 24px}
  th{background:#f5f5f5;padding:10px 12px;text-align:left;font-size:13px;border-bottom:2px solid #ddd}
  td{padding:10px 12px;border-bottom:1px solid #eee;font-size:13px}
  .footer{text-align:center;color:#aaa;font-size:12px;margin-top:40px;border-top:1px solid #eee;padding-top:16px}
  @media print{
    body{padding:0}
    .footer{position:fixed;bottom:0;width:100%}
  }
</style>
</head>
<body>
  <h1>综测成绩与材料报告</h1>
  <p class="subtitle">${escapeHtml(student.year_name || '')} 学年 · 生成时间：${new Date().toLocaleDateString('zh-CN')}</p>

  <div class="info-grid">
    <div class="info-item"><span>姓名：</span>${escapeHtml(student.name)}</div>
    <div class="info-item"><span>学号：</span>${escapeHtml(student.student_id)}</div>
    <div class="info-item"><span>班级：</span>${escapeHtml(student.class_name)}</div>
    <div class="info-item"><span>学院：</span>${escapeHtml(student.college_name || '-')}</div>
    <div class="info-item"><span>专业：</span>${escapeHtml(student.major || '-')}</div>
    <div class="info-item"><span>年级：</span>${escapeHtml(student.grade || '-')}</div>
  </div>

  <div class="score-box">
    <div class="total">${totalScore}</div>
    <div class="rank">班级排名：第 ${myRank ? myRank.rank : '-'} 名（共 ${rankings.length} 人）</div>
  </div>

  <h2>📎 加分材料提交记录</h2>
  <table>
    <thead><tr><th>模块</th><th>加分项</th><th>分数</th><th>状态</th><th>获奖时间</th><th>理由</th><th>证明材料</th></tr></thead>
    <tbody>${subsHtml}</tbody>
  </table>

  <h2>📊 教师导入成绩</h2>
  <table>
    <thead><tr><th>模块</th><th>项目</th><th>成绩</th></tr></thead>
    <tbody>${importedHtml}</tbody>
  </table>

  <div class="footer">
    <p>本报告由综测管理平台自动生成 · 仅供内部使用</p>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
