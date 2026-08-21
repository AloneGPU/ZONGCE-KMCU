const Score = require('../models/score');
const pool = require('../config/database');
const { getCurrentYearId } = require('../utils/year');
const auditLog = require('../utils/audit');
const path = require('path');
const fs = require('fs');
const Teacher = require('../models/teacher');
const { streamZipFiles } = require('../utils/zip');
const { sanitizeFilePart, getUploadRoot, resolveStoredFile } = require('../utils/upload');
const { resolveManagedClassScope, canonicalizeClassNames, normalizeClassName, normalizeGrade } = require('../utils/className');

async function filterRankingsForRequester(req, rankings, className) {
  if (!req.user || req.user.role !== 'counselor') return rankings;
  const teacher = await Teacher.findByUserId(req.user.userId);
  const scope = await resolveManagedClassScope(pool, teacher);
  const allowedClasses = scope.classNames;
  const teacherGrade = scope.grade;
  if (allowedClasses.length === 0) {
    const err = new Error('未配置负责班级，无法导出成绩');
    err.statusCode = 403;
    throw err;
  }
  if (className && !allowedClasses.some(item => normalizeClassName(item) === normalizeClassName(className))) {
    const err = new Error('无权导出该班级成绩');
    err.statusCode = 403;
    throw err;
  }
  return rankings.filter(item =>
    allowedClasses.some(classItem => normalizeClassName(classItem) === normalizeClassName(item.className)) &&
    (!teacherGrade || normalizeGrade(item.grade) === normalizeGrade(teacherGrade))
  );
}

function actualModuleScore(moduleId, score) {
  const raw = Number(score || 0);
  // 基础分规则统一由 Score.moduleBaseScore 提供，避免此处硬编码重复
  return Score.moduleBaseScore(moduleId) + raw;
}

function styleExportSheet(ws) {
  const border = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };
  ws.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = border;
      cell.font = { name: '宋体', size: 10, bold: rowNumber === 1 };
      if (rowNumber === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
      }
    });
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

async function sendXlsx(res, filename, sheetName, headers, rows) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = '综测管理平台';
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  rows.forEach(row => ws.addRow(row));
  headers.forEach((header, index) => {
    const headerWidth = String(header).length * 2 + 4;
    ws.getColumn(index + 1).width = Math.max(10, Math.min(24, headerWidth));
  });
  styleExportSheet(ws);
  const buffer = await wb.xlsx.writeBuffer();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(buffer);
}

function uniqueName(name, used) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let index = 1;
  while (used.has(candidate)) {
    candidate = `${base}_${index}${ext}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function stripGeneratedPrefix(row, baseName, moduleLabel, scoreText) {
  const prefix = [
    sanitizeFilePart(row.student_id, '学号'),
    sanitizeFilePart(row.student_name, '姓名'),
    sanitizeFilePart(moduleLabel, '加分类'),
    sanitizeFilePart(`${scoreText}分`, '分值'),
  ].join('_') + '_';
  return baseName.startsWith(prefix) ? baseName.slice(prefix.length) : baseName;
}

function buildProofExportName(row, usedNames) {
  const sourceExt = path.extname(row.proof_filename || row.proof_path || '').toLowerCase();
  const ext = ['.jpg', '.jpeg', '.png', '.gif'].includes(sourceExt) ? sourceExt : path.extname(row.proof_path || '').toLowerCase() || '.jpg';
  const moduleLabel = String(row.module_name || '加分项').endsWith('类') ? row.module_name : `${row.module_name || '加分项'}类`;
  const score = Number(row.score || 0);
  const scoreText = Number.isInteger(score) ? String(score) : score.toFixed(1).replace(/\.0$/, '');
  const rawBase = path.basename(row.proof_filename || row.proof_path || '证明材料', sourceExt || ext);
  const customName = stripGeneratedPrefix(row, rawBase, moduleLabel, scoreText);
  const filename = [
    sanitizeFilePart(row.student_id, '学号'),
    sanitizeFilePart(row.student_name, '姓名'),
    sanitizeFilePart(moduleLabel, '加分类'),
    sanitizeFilePart(`${scoreText}分`, '分值'),
    sanitizeFilePart(customName, '证明材料'),
  ].join('_') + ext;
  return uniqueName(filename, usedNames);
}

function toProofRelativePath(uploadRoot, filePath) {
  return path.relative(uploadRoot, filePath).split(path.sep).join('/');
}

async function listStoredProofFiles(dir, uploadRoot, result = []) {
  if (!fs.existsSync(dir)) return result;
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '_incoming') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await listStoredProofFiles(fullPath, uploadRoot, result);
    } else if (/\.(jpe?g|png|gif)$/i.test(entry.name)) {
      result.push(toProofRelativePath(uploadRoot, fullPath));
    }
  }
  return result;
}

// 管理员检查数据库 proof_path 与上传目录图片是否一一对应。
exports.checkProofFileConsistency = async (req, res) => {
  try {
    const yearId = await getCurrentYearId(req.query.yearId);
    const uploadRoot = getUploadRoot();
    const [rows] = await pool.query(
      `SELECT sub.id, sub.proof_path, sub.proof_filename,
              s.student_id, s.name as student_name, s.class_name,
              ay.name as year_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN academic_years ay ON sub.academic_year_id = ay.id
       WHERE sub.academic_year_id = ? AND sub.proof_path IS NOT NULL AND sub.proof_path != ''
       ORDER BY s.class_name, s.student_id, sub.id`,
      [yearId]
    );

    const dbPaths = new Set();
    const missing = [];
    const invalidPath = [];

    for (const row of rows) {
      const normalized = String(row.proof_path || '').replace(/\\/g, '/');
      dbPaths.add(normalized);
      const filePath = path.resolve(uploadRoot, normalized);
      if (!filePath.startsWith(uploadRoot + path.sep)) {
        invalidPath.push(row);
      } else if (!fs.existsSync(filePath)) {
        missing.push(row);
      }
    }

    const storedFiles = await listStoredProofFiles(uploadRoot, uploadRoot);
    const orphanFiles = storedFiles.filter(file => !dbPaths.has(file));

    const result = {
      yearId,
      uploadRoot,
      dbFileCount: rows.length,
      storedFileCount: storedFiles.length,
      okCount: rows.length - missing.length - invalidPath.length,
      missingCount: missing.length,
      invalidPathCount: invalidPath.length,
      orphanFileCount: orphanFiles.length,
      missing: missing.slice(0, 50),
      invalidPath: invalidPath.slice(0, 50),
      orphanFiles: orphanFiles.slice(0, 50),
    };

    await auditLog(req, 'proofFiles.check', 'academic_year', yearId, {
      dbFileCount: result.dbFileCount,
      storedFileCount: result.storedFileCount,
      missingCount: result.missingCount,
      orphanFileCount: result.orphanFileCount,
    });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// 清理一致性检查中发现的孤立图片（仅限数据库已无引用的文件）
exports.cleanupOrphanProofFiles = async (req, res) => {
  try {
    const files = Array.isArray(req.body && req.body.files) ? req.body.files : [];
    if (files.length === 0) return res.status(400).json({ error: '没有选择要清理的文件' });
    if (files.length > 200) return res.status(400).json({ error: '单次最多清理 200 个文件' });

    const [allRows] = await pool.query(
      "SELECT proof_path FROM submissions WHERE proof_path IS NOT NULL AND proof_path != ''"
    );
    const dbPaths = new Set(allRows.map(r => String(r.proof_path).replace(/\\/g, '/')));

    const deleted = [];
    const failed = [];
    for (const raw of files) {
      const rel = String(raw || '').replace(/\\/g, '/');
      if (!rel || rel.includes('..') || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
        failed.push({ file: raw, reason: '非法路径' });
        continue;
      }
      if (dbPaths.has(rel)) {
        failed.push({ file: rel, reason: '数据库仍引用该文件，已跳过' });
        continue;
      }
      try {
        const fullPath = resolveStoredFile(rel); // 强制限定在 UPLOAD_ROOT 内
        fs.unlinkSync(fullPath);
        deleted.push(rel);
      } catch (err) {
        if (err.code === 'ENOENT') {
          deleted.push(rel); // 文件本来就不存在，视为清理成功
        } else {
          failed.push({ file: rel, reason: err.message });
        }
      }
    }

    await auditLog(req, 'proofFiles.cleanup', 'academic_year', 0, {
      deletedCount: deleted.length, failedCount: failed.length,
    });
    res.json({ deletedCount: deleted.length, failedCount: failed.length, deleted, failed });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// 导出综合成绩 CSV
exports.exportClassCSV = async (req, res) => {
  try {
    const { yearId, format } = req.query;
    const grade = String(req.query.grade || '').trim();
    const [className] = req.query.className ? await canonicalizeClassNames(pool, [String(req.query.className)]) : [''];
    const yearIdNum = await getCurrentYearId(yearId);

    let rankings = await Score.getRankings(yearIdNum, className || null, grade && grade !== 'all' ? grade : undefined);
    rankings = await filterRankingsForRequester(req, rankings, className);
    if (grade && grade !== 'all') rankings = rankings.filter(item => normalizeGrade(item.grade) === normalizeGrade(grade));
    const [modRows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    // 预热基础分缓存，actualModuleScore 内部只需同步读取
    await Score.ensureBaseScores();

    const headers = ['排名', '学号', '姓名', '班级', ...modRows.map(m => m.name + '(' + Number(m.weight) + '%)'), '综测总分'];
    const dataRows = rankings.map(r => {
      const modScores = modRows.map(m => {
        const ms = r.modules.find(mm => mm.moduleId === m.id);
        return actualModuleScore(m.id, ms ? ms.score : 0);
      });
      return [r.rank, r.studentCode, r.studentName, r.className, ...modScores, r.totalScore];
    });

    const filename = className
      ? className + '_综测成绩_' + yearIdNum + (format === 'xlsx' ? '.xlsx' : '.csv')
      : '综测成绩汇总' + (format === 'xlsx' ? '.xlsx' : '.csv');

    await auditLog(req, 'export.class', 'academic_year', yearIdNum, { className: className || null, grade: grade || null, format: format || 'csv' });

    if (format === 'xlsx') {
      return await sendXlsx(res, filename, '综测成绩', headers, dataRows);
    }

    let csv = '﻿'; // BOM for Excel
    csv += headers.join(',') + '\n';

    for (const row of dataRows) {
      csv += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(filename) + '"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 导出模块成绩 CSV（含各加分项明细）
exports.exportModuleCSV = async (req, res) => {
  try {
    const { moduleId, yearId, format } = req.query;
    const grade = String(req.query.grade || '').trim();
    const [className] = req.query.className ? await canonicalizeClassNames(pool, [String(req.query.className)]) : [''];
    const yearIdNum = await getCurrentYearId(yearId);
    const modId = parseInt(moduleId);

    const [items] = await pool.query('SELECT * FROM scoring_items WHERE module_id = ? ORDER BY sort_order', [modId]);
    const [mod] = await pool.query('SELECT * FROM scoring_modules WHERE id = ?', [modId]);
    if (!mod[0]) return res.status(404).json({ error: '模块不存在' });

    let rankings = await Score.getRankings(yearIdNum, className || null, grade && grade !== 'all' ? grade : undefined);
    rankings = await filterRankingsForRequester(req, rankings, className);
    if (grade && grade !== 'all') rankings = rankings.filter(item => normalizeGrade(item.grade) === normalizeGrade(grade));
    await Score.ensureBaseScores();

    // 按该模块实际得分排序，德育/能力/美育/劳动包含60分基础分。
    rankings.sort((a, b) => {
      const am = a.modules.find(m => m.moduleId === modId);
      const bm = b.modules.find(m => m.moduleId === modId);
      return actualModuleScore(modId, bm ? bm.score : 0) - actualModuleScore(modId, am ? am.score : 0);
    });
    rankings.forEach((r, i) => r.modRank = i + 1);

    // 查询该学年该模块所有已通过的提交和导入成绩，按学生+加分项分组
    const [subScores] = await pool.query(
      `SELECT student_id, item_id, SUM(score) as score
       FROM submissions WHERE academic_year_id = ? AND module_id = ? AND status = 'approved'
       GROUP BY student_id, item_id`, [yearIdNum, modId]
    );
    const [impScores] = await pool.query(
      `SELECT student_id, item_id, SUM(score) as score
       FROM imported_scores WHERE academic_year_id = ? AND module_id = ?
       GROUP BY student_id, item_id`, [yearIdNum, modId]
    );

    const headers = ['排名', '学号', '姓名', '班级', ...items.map(i => i.name), mod[0].name + '总分'];
    const dataRows = rankings.map(r => {
      const itemScores = items.map(item => {
        const sub = subScores.find(s => s.student_id === r.studentId && s.item_id === item.id);
        const imp = impScores.find(s => s.student_id === r.studentId && s.item_id === item.id);
        return (sub ? Number(sub.score) : 0) + (imp ? Number(imp.score) : 0);
      });
      const modTotal = r.modules.find(m => m.moduleId === modId);
      return [r.modRank, r.studentCode, r.studentName, r.className, ...itemScores, actualModuleScore(modId, modTotal ? modTotal.score : 0)];
    });

    const filename = mod[0].name + '_' + yearIdNum + (format === 'xlsx' ? '.xlsx' : '.csv');
    await auditLog(req, 'export.module', 'scoring_module', modId, { className: className || null, grade: grade || null, yearId: yearIdNum, format: format || 'csv' });

    if (format === 'xlsx') {
      return await sendXlsx(res, filename, mod[0].name, headers, dataRows);
    }

    let csv = '﻿';
    csv += headers.join(',') + '\n';
    for (const row of dataRows) {
      csv += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(filename) + '"');
    res.send(csv);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

// 数据存档 (JSON)
exports.archive = async (req, res) => {
  try {
    const yearId = await getCurrentYearId(req.query.yearId);

    const [students] = await pool.query('SELECT * FROM students');
    const [teachers] = await pool.query('SELECT * FROM teachers');
    const [submissions] = await pool.query('SELECT * FROM submissions WHERE academic_year_id = ?', [yearId]);
    const [scores] = await pool.query('SELECT * FROM imported_scores WHERE academic_year_id = ?', [yearId]);
    const [rules] = await pool.query(
      'SELECT sm.*, si.* FROM scoring_modules sm LEFT JOIN scoring_items si ON sm.id = si.module_id'
    );
    const [year] = await pool.query('SELECT * FROM academic_years WHERE id = ?', [yearId]);

    const archive = {
      exportTime: new Date().toISOString(),
      year: year[0] || null,
      students: students,
      teachers: teachers,
      submissions: submissions,
      scores: scores,
      rules: rules,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent('综测数据存档_' + (year[0] ? year[0].name : yearId) + '.json') + '"');
    await auditLog(req, 'export.archive', 'academic_year', yearId, null);
    res.json(archive);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 批量导出证明图片 ZIP。数据库 proof_path 与实际文件必须一一对应，否则拒绝导出。
exports.exportProofImagesZip = async (req, res) => {
  try {
    const yearId = await getCurrentYearId(req.query.yearId);
    const className = String(req.query.className || '').trim();
    const grade = String(req.query.grade || '').trim();
    const status = String(req.query.status || 'all').trim();

    const where = ['sub.academic_year_id = ?', 'sub.proof_path IS NOT NULL', "sub.proof_path != ''"];
    const params = [yearId];

    if (status && status !== 'all') {
      where.push('sub.status = ?');
      params.push(status);
    }
    if (grade && grade !== 'all') {
      where.push('s.grade = ?');
      params.push(grade);
    }

    if (req.user.role === 'admin') {
      if (className && className !== 'all') {
        where.push('s.class_name = ?');
        params.push(className);
      }
    } else if (req.user.role === 'counselor') {
      const teacher = await Teacher.findByUserId(req.user.userId);
      const scope = await resolveManagedClassScope(pool, teacher);
      const allowedClasses = scope.classNames;
      const teacherGrade = scope.grade;
      if (allowedClasses.length === 0) return res.status(403).json({ error: '未配置负责班级，无法导出证明图片' });
      const requestedClasses = className && className !== 'all' ? [className] : allowedClasses;
      const invalidClass = requestedClasses.find(cls => !allowedClasses.includes(cls));
      if (invalidClass) return res.status(403).json({ error: '无权导出该班级证明图片' });
      where.push(`s.class_name IN (${requestedClasses.map(() => '?').join(',')})`);
      params.push(...requestedClasses);
      if (teacherGrade) {
        where.push('s.grade = ?');
        params.push(teacherGrade);
      }
    } else if (req.studentInfo && req.studentInfo.is_assistant) {
      const assistantClass = req.studentInfo && req.studentInfo.class_name;
      const assistantGrade = req.studentInfo && req.studentInfo.grade;
      if (!assistantClass) return res.status(403).json({ error: '未找到班委负责班级，无法导出证明图片' });
      where.push('s.class_name = ?');
      params.push(assistantClass);
      if (assistantGrade) {
        where.push('s.grade = ?');
        params.push(assistantGrade);
      }
      where.push('sub.assistant_assignee_id = ?');
      params.push(req.user.userId);
    } else {
      return res.status(403).json({ error: '无权导出证明图片' });
    }

    const [rows] = await pool.query(
      `SELECT sub.id, sub.score, sub.status, sub.proof_filename, sub.proof_path,
              s.student_id, s.name as student_name, s.class_name, s.grade,
              sm.name as module_name, ay.name as year_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN academic_years ay ON sub.academic_year_id = ay.id
       WHERE ${where.join(' AND ')}
       ORDER BY s.class_name, s.student_id, sm.sort_order, sub.submit_at`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '当前筛选条件下没有可导出的证明图片' });
    }

    const uploadRoot = getUploadRoot();
    const missing = [];
    const usedNames = new Set();
    const files = [];

    for (const row of rows) {
      const filePath = path.resolve(uploadRoot, row.proof_path);
      if (!filePath.startsWith(uploadRoot + path.sep) || !fs.existsSync(filePath)) {
        missing.push({ id: row.id, proof_path: row.proof_path });
        continue;
      }
      files.push({
        name: buildProofExportName(row, usedNames),
        path: filePath,
      });
    }

    if (missing.length > 0) {
      return res.status(409).json({
        error: `有 ${missing.length} 条数据库文件地址找不到对应图片，请先修复上传目录与数据库的一一对应关系`,
        missing: missing.slice(0, 20),
      });
    }

    const [yearRows] = await pool.query('SELECT name FROM academic_years WHERE id = ?', [yearId]);
    const yearName = yearRows[0] ? yearRows[0].name : String(yearId);
    const scopeName = req.studentInfo && req.studentInfo.is_assistant
      ? req.studentInfo.class_name
      : (className && className !== 'all' ? className : (grade && grade !== 'all' ? grade : '全部'));
    const filename = `${yearName}_${scopeName}_证明图片.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    await auditLog(req, 'export.proofImages', 'academic_year', yearId, { className: className || null, grade: grade || null, status, count: files.length });
    await streamZipFiles(res, files);
  } catch (err) {
    if (!res.headersSent) return res.status(500).json({ error: err.message });
    res.destroy(err);
  }
};
