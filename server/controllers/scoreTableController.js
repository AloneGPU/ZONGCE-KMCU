/**
 * 综合测评登分表 — 按学校模板格式（35列，6模块双层表头，按总分降序排名）
 * 参考格式: 品德(5) | 智育(3) | 体育(5) | 能力(5) | 美育(5) | 劳动(5) | 汇总(3)
 */
const Score = require('../models/score');
const pool = require('../config/database');
const { getCurrentYearId } = require('../utils/year');
const { canonicalizeClassNames, normalizeClassName, normalizeGrade, resolveManagedClassScope } = require('../utils/className');

// 单个学生级计算（与 score.js calcTotalScore 公式一致）
async function calcStudentScoreTable(studentId, yearId) {
  const [modRows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
  await Score.ensureBaseScores();

  const [subScores] = await pool.query(
    `SELECT module_id, SUM(score) as total FROM submissions WHERE student_id=? AND academic_year_id=? AND status='approved' GROUP BY module_id`,
    [studentId, yearId]
  );
  const [impScores] = await pool.query(
    `SELECT module_id, SUM(score) as total FROM imported_scores WHERE student_id=? AND academic_year_id=? GROUP BY module_id`,
    [studentId, yearId]
  );

  const moduleTotals = {};
  for (const m of modRows) moduleTotals[m.id] = 0;
  for (const s of subScores) moduleTotals[s.module_id] = (moduleTotals[s.module_id] || 0) + Number(s.total);
  for (const s of impScores) moduleTotals[s.module_id] = (moduleTotals[s.module_id] || 0) + Number(s.total);

  const modScores = {};
  for (const m of modRows) {
    let raw = moduleTotals[m.id] || 0;
    raw = Score.moduleBaseScore(m.id) + raw;
    modScores[m.id] = { id: m.id, name: m.name, weight: Number(m.weight), raw: raw };
  }

  const totalScore = +Object.values(modScores).reduce((s, m) => s + +(m.raw * m.weight / 100).toFixed(2), 0).toFixed(2);

  const m1 = modScores[1] || { raw: 60 };
  const m2 = modScores[2] || { raw: 0 };
  const m3 = modScores[3] || { raw: 0 };
  const m4 = modScores[4] || { raw: 60 };
  const m5 = modScores[5] || { raw: 60 };
  const m6 = modScores[6] || { raw: 60 };

  // 35列格式（参照学校模板）: 序号|学号|姓名|性别 + 6模块(操行+分值) + 操行汇总|综测总分|排名
  return {
    // 德育(5列): 基础分|加分|减分|实际合计|加权分——无操行列
    d1Base: 60, d1Bonus: +(Math.max(m1.raw - 60, 0)).toFixed(1), d1Deduct: 0, d1Total: m1.raw, d1Weighted: +(m1.raw * 0.2).toFixed(2),
    // 智育(3列): 操行|学业成绩|加权分
    d2Conduct: 0, d2Total: m2.raw, d2Weighted: +(m2.raw * 0.4).toFixed(2),
    // 体育(5列): 操行|基础分|加分|实际合计|加权分
    d3Conduct: 0, d3Base: m3.raw, d3Bonus: 0, d3Total: m3.raw, d3Weighted: +(m3.raw * 0.1).toFixed(2),
    // 能力(5列): 操行|基础分|加分|实际合计|加权分
    d4Conduct: 0, d4Base: 60, d4Bonus: +(Math.max(m4.raw - 60, 0)).toFixed(1), d4Total: m4.raw, d4Weighted: +(m4.raw * 0.1).toFixed(2),
    // 美育(5列): 操行|基础分|加分|实际合计|加权分
    d5Conduct: 0, d5Base: 60, d5Bonus: +(Math.max(m5.raw - 60, 0)).toFixed(1), d5Total: m5.raw, d5Weighted: +(m5.raw * 0.1).toFixed(2),
    // 劳动(5列): 操行|基础分|加分|实际合计|加权分
    d6Conduct: 0, d6Base: 60, d6Bonus: +(Math.max(m6.raw - 60, 0)).toFixed(1), d6Total: m6.raw, d6Weighted: +(m6.raw * 0.1).toFixed(2),
    conductTotal: 0,
    totalScore,
  };
}

// ============ 35列表头定义（与学校模板一致：每个模块都带排名） ============
const ROW1_HEADERS = ['', '', '', '',
  '德育素质', '', '', '', '', '',
  '智育素质', '', '',
  '体育素质', '', '', '', '',
  '能力素质', '', '', '', '',
  '美育素质', '', '', '', '',
  '劳动素质', '', '', '', '',
  '综测', ''];
const ROW2_HEADERS = ['序号', '学号', '姓名', '性别',
  '基本评议得分', '加分', '扣分', '实际合计', '换算素质分(×0.2)', '排名',
  '实际合计', '换算素质分(×0.4)', '排名',
  '基础分', '加分', '实际合计', '换算素质分(×0.1)', '排名',
  '基本分', '加分', '实际合计', '换算素质分(×0.1)', '排名',
  '基本分', '加分', '实际合计', '换算素质分(×0.1)', '排名',
  '基本分', '加分', '实际合计', '换算素质分(×0.1)', '排名',
  '综测总分', '排名'];
const CSV_HEADERS = ['序号', '学号', '姓名', '性别',
  '德育基础分', '德育加分', '德育扣分', '德育实际合计', '德育加权分', '德育排名',
  '智育实际合计', '智育加权分', '智育排名',
  '体育基础分', '体育加分', '体育实际合计', '体育加权分', '体育排名',
  '能力基本分', '能力加分', '能力实际合计', '能力加权分', '能力排名',
  '美育基本分', '美育加分', '美育实际合计', '美育加权分', '美育排名',
  '劳动基本分', '劳动加分', '劳动实际合计', '劳动加权分', '劳动排名',
  '综测总分', '综测排名'];

function assignRanks(rows) {
  const configs = [
    ['d1Total', 'd1Rank'],
    ['d2Total', 'd2Rank'],
    ['d3Total', 'd3Rank'],
    ['d4Total', 'd4Rank'],
    ['d5Total', 'd5Rank'],
    ['d6Total', 'd6Rank'],
    ['totalScore', 'rank'],
  ];
  for (const [scoreKey, rankKey] of configs) {
    [...rows]
      .sort((a, b) => Number(b[scoreKey] || 0) - Number(a[scoreKey] || 0))
      .forEach((row, index) => { row[rankKey] = index + 1; });
  }
}

function totalRow(r, index) {
  return [
    index + 1, r.student_id, r.name, r.gender,
    r.d1Base, r.d1Bonus, r.d1Deduct, r.d1Total, r.d1Weighted, r.d1Rank,
    r.d2Total, r.d2Weighted, r.d2Rank,
    r.d3Base, r.d3Bonus, r.d3Total, r.d3Weighted, r.d3Rank,
    r.d4Base, r.d4Bonus, r.d4Total, r.d4Weighted, r.d4Rank,
    r.d5Base, r.d5Bonus, r.d5Total, r.d5Weighted, r.d5Rank,
    r.d6Base, r.d6Bonus, r.d6Total, r.d6Weighted, r.d6Rank,
    r.totalScore, r.rank
  ];
}

const MODULE_EXPORT_CONFIGS = {
  1: {
    title: '德育',
    rankKey: 'd1Rank',
    headers: ['基本评议得分', '加分', '扣分', '实际合计', '换算素质分(×0.2)'],
    widths: [6, 14, 10, 6, 14, 8, 8, 10, 18, 8],
    map: r => [r.d1Base, r.d1Bonus, r.d1Deduct, r.d1Total, r.d1Weighted],
  },
  2: {
    title: '智育',
    rankKey: 'd2Rank',
    headers: ['实际合计', '换算素质分(×0.4)'],
    widths: [6, 14, 10, 6, 12, 18, 8],
    map: r => [r.d2Total, r.d2Weighted],
  },
  3: {
    title: '体育',
    rankKey: 'd3Rank',
    headers: ['基础分', '加分', '实际合计', '换算素质分(×0.1)'],
    widths: [6, 14, 10, 6, 10, 8, 10, 18, 8],
    map: r => [r.d3Base, r.d3Bonus, r.d3Total, r.d3Weighted],
  },
  4: {
    title: '能力',
    rankKey: 'd4Rank',
    headers: ['基本分', '加分', '实际合计', '换算素质分(×0.1)'],
    widths: [6, 14, 10, 6, 10, 8, 10, 18, 8],
    map: r => [r.d4Base, r.d4Bonus, r.d4Total, r.d4Weighted],
  },
  5: {
    title: '美育',
    rankKey: 'd5Rank',
    headers: ['基本分', '加分', '实际合计', '换算素质分(×0.1)'],
    widths: [6, 14, 10, 6, 10, 8, 10, 18, 8],
    map: r => [r.d5Base, r.d5Bonus, r.d5Total, r.d5Weighted],
  },
  6: {
    title: '劳动',
    rankKey: 'd6Rank',
    headers: ['基本分', '加分', '实际合计', '换算素质分(×0.1)'],
    widths: [6, 14, 10, 6, 10, 8, 10, 18, 8],
    map: r => [r.d6Base, r.d6Bonus, r.d6Total, r.d6Weighted],
  },
};

function getModuleExportConfig(moduleId) {
  const id = Number(moduleId || 0);
  return MODULE_EXPORT_CONFIGS[id] || null;
}

async function fetchStudentsByNormalizedScope(classNames = [], grade = '') {
  const [rows] = await pool.query('SELECT * FROM students ORDER BY class_name, student_id');
  const classKeys = new Set((classNames || []).map(normalizeClassName).filter(Boolean));
  const gradeText = normalizeGrade(grade);
  return rows.filter(row => {
    const classMatched = classKeys.size === 0 || classKeys.has(normalizeClassName(row.class_name));
    const gradeMatched = !gradeText || gradeText === 'all' || normalizeGrade(row.grade) === gradeText;
    return classMatched && gradeMatched;
  });
}

async function getScoreTableStudents(req, className, requestedGrade, emptyCounselorIsError = true) {
  if (req.user && req.user.role === 'counselor') {
    const Teacher = require('../models/teacher');
    const teacher = await Teacher.findByUserId(req.user.userId);
    const scope = await resolveManagedClassScope(pool, teacher);
    const allowedClasses = scope.classNames;
    const teacherGrade = scope.grade;

    if (className) {
      const allowedKeys = new Set(allowedClasses.map(normalizeClassName));
      if (!allowedKeys.has(normalizeClassName(className))) {
        const err = new Error('无权查看或导出该班级登分表');
        err.statusCode = 403;
        throw err;
      }
      return fetchStudentsByNormalizedScope([className], teacherGrade);
    }

    if (allowedClasses.length === 0) {
      if (!emptyCounselorIsError) return [];
      const err = new Error('未配置负责班级，无法导出登分表');
      err.statusCode = 403;
      throw err;
    }
    return fetchStudentsByNormalizedScope(allowedClasses, teacherGrade);
  }

  if (req.studentInfo && req.studentInfo.is_assistant) {
    const assistantClass = String(req.studentInfo.class_name || '');
    const assistantGrade = String(req.studentInfo.grade || '');
    if (!assistantClass) {
      const err = new Error('未配置班委所在班级，无法查看或导出登分表');
      err.statusCode = 403;
      throw err;
    }
    if (className && normalizeClassName(className) !== normalizeClassName(assistantClass)) {
      const err = new Error('无权查看或导出其他班级登分表');
      err.statusCode = 403;
      throw err;
    }
    return fetchStudentsByNormalizedScope([assistantClass], assistantGrade);
  }

  const grade = requestedGrade && requestedGrade !== 'all' ? requestedGrade : '';
  return fetchStudentsByNormalizedScope(className ? [className] : [], grade);
}

// ============ CSV / XLSX 导出（统一入口） ============
exports.exportScoreTable = async (req, res) => {
  try {
    const { format } = req.query;
    const moduleConfig = getModuleExportConfig(req.query.moduleId);
    const requestedGrade = String(req.query.grade || '').trim();
    const [className] = req.query.className ? await canonicalizeClassNames(pool, [String(req.query.className)]) : [''];
    const yearId = await getCurrentYearId(req.query.yearId || '');

    const studentRows = await getScoreTableStudents(req, className, requestedGrade);
    if (studentRows.length === 0) {
      return res.status(404).json({
        error: '没有匹配到可导出的学生数据，请检查所选年级、班级以及辅导员负责范围是否一致。'
      });
    }

    const rows = [];
    for (const s of studentRows) {
      const data = await calcStudentScoreTable(s.id, yearId);
      rows.push({ student_id: s.student_id, name: s.name, gender: s.gender || '', class_name: s.class_name, grade: s.grade, college_name: s.college_name, ...data });
    }
    assignRanks(rows);
    rows.sort((a, b) => a.rank - b.rank);

    const [yearRows] = await pool.query('SELECT name FROM academic_years WHERE id = ?', [yearId]);
    const yearName = yearRows[0] ? yearRows[0].name : String(yearId);

    if (format === 'xlsx') return await exportXLSX(res, rows, className, yearName, moduleConfig);
    if (moduleConfig) return exportModuleCSV(res, rows, className, moduleConfig);
    return exportCSV(res, rows, className);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

function exportCSV(res, rows, className) {
  const BOM = '﻿';
  let csv = BOM + CSV_HEADERS.join(',') + '\n';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    csv += [
      i + 1, r.student_id, r.name, r.gender,
      r.d1Base, r.d1Bonus, r.d1Deduct, r.d1Total, r.d1Weighted, r.d1Rank,
      r.d2Total, r.d2Weighted, r.d2Rank,
      r.d3Base, r.d3Bonus, r.d3Total, r.d3Weighted, r.d3Rank,
      r.d4Base, r.d4Bonus, r.d4Total, r.d4Weighted, r.d4Rank,
      r.d5Base, r.d5Bonus, r.d5Total, r.d5Weighted, r.d5Rank,
      r.d6Base, r.d6Bonus, r.d6Total, r.d6Weighted, r.d6Rank,
      r.totalScore, r.rank
    ].join(',') + '\n';
  }
  const filename = (className || '全部班级') + '_综合测评登分表.csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(filename));
  res.send(csv);
}

function exportModuleCSV(res, rows, className, config) {
  const BOM = '﻿';
  const headers = ['序号', '学号', '姓名', '性别', ...config.headers, '排名'];
  const sortedRows = [...rows].sort((a, b) => Number(a[config.rankKey] || 999999) - Number(b[config.rankKey] || 999999));
  let csv = BOM + headers.join(',') + '\n';
  sortedRows.forEach((r, index) => {
    csv += [
      index + 1,
      r.student_id,
      r.name,
      r.gender,
      ...config.map(r),
      r[config.rankKey],
    ].join(',') + '\n';
  });
  const filename = (className || '全部班级') + '_' + config.title + '单项成绩表.csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(filename));
  res.send(csv);
}

function styleSheet(ws, headerRows = 1) {
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  const titleFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
  const border = {
    top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  };

  ws.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = border;
      if (rowNumber <= headerRows) {
        cell.font = { name: '宋体', size: rowNumber === 1 && headerRows > 2 ? 14 : 10, bold: true };
        cell.fill = rowNumber <= Math.max(headerRows - 2, 0) ? titleFill : headerFill;
      } else {
        cell.font = { name: '宋体', size: 10 };
      }
    });
  });
}

function setDefaultWidths(ws, widths) {
  widths.forEach((width, index) => {
    ws.getColumn(index + 1).width = width;
  });
}

function mergeTotalHeaders(ws, startRow = 1) {
  const row1 = startRow;
  ws.mergeCells(row1, 5, row1, 10);
  ws.mergeCells(row1, 11, row1, 13);
  ws.mergeCells(row1, 14, row1, 18);
  ws.mergeCells(row1, 19, row1, 23);
  ws.mergeCells(row1, 24, row1, 28);
  ws.mergeCells(row1, 29, row1, 33);
  ws.mergeCells(row1, 34, row1, 35);
}

function parseClassParts(className, rows) {
  const source = className || (rows[0] && rows[0].class_name) || '';
  const grade = (rows[0] && rows[0].grade) || '';
  const college = (rows[0] && rows[0].college_name) || '数据科学与工程学院';
  const match = String(source).match(/^(.+?)(\d+班)$/);
  return {
    college,
    grade,
    major: match ? match[1] : source || '全部专业',
    classNo: match ? match[2] : source || '全部班级',
  };
}

function addTotalModuleSheet(wb, rows) {
  const ws = wb.addWorksheet('总模块');
  ws.addRow(ROW1_HEADERS);
  ws.addRow(ROW2_HEADERS);
  mergeTotalHeaders(ws, 1);
  rows.forEach((r, index) => ws.addRow(totalRow(r, index)));
  setDefaultWidths(ws, [6, 14, 10, 6, 10, 8, 8, 10, 14, 8, 10, 14, 8, 10, 8, 10, 14, 8, 10, 8, 10, 14, 8, 10, 8, 10, 14, 8, 10, 8, 10, 14, 8, 12, 8]);
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  styleSheet(ws, 2);
  return ws;
}

function addModuleSheet(wb, title, headers, rows, mapper, rankKey) {
  const ws = wb.addWorksheet(title);
  ws.addRow(headers);
  [...rows]
    .sort((a, b) => Number(a[rankKey] || 999999) - Number(b[rankKey] || 999999))
    .forEach(row => ws.addRow(mapper(row)));
  setDefaultWidths(ws, headers.map(header => String(header).includes('换算') ? 18 : 12));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  styleSheet(ws, 1);
  return ws;
}

function addSingleModuleReportSheet(wb, config, rows, className, yearName) {
  const ws = wb.addWorksheet(config.title);
  const info = parseClassParts(className, rows);
  const headers = ['序号', '学号', '姓名', '性别', ...config.headers, '排名'];
  const columnCount = headers.length;
  ws.addRow([`${yearName} 学年${info.college}学生综合素质测评${config.title}单项成绩登记表`]);
  ws.addRow([`专业：${info.major}            年级：${info.grade || ''}             班级：${info.classNo}         学生人数：${rows.length}`]);
  ws.addRow(['', '', '', '', ...Array(config.headers.length).fill(`${config.title}素质`), '']);
  ws.addRow(headers);
  ws.mergeCells(1, 1, 1, columnCount);
  ws.mergeCells(2, 1, 2, columnCount);
  if (config.headers.length > 1) ws.mergeCells(3, 5, 3, 4 + config.headers.length);
  [...rows]
    .sort((a, b) => Number(a[config.rankKey] || 999999) - Number(b[config.rankKey] || 999999))
    .forEach((r, index) => ws.addRow([
      index + 1,
      r.student_id,
      r.name,
      r.gender,
      ...config.map(r),
      r[config.rankKey],
    ]));
  setDefaultWidths(ws, config.widths);
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  styleSheet(ws, 4);
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 22;
  return ws;
}

function addComprehensiveSheet(wb, rows, className, yearName) {
  const ws = wb.addWorksheet('综测');
  const info = parseClassParts(className, rows);
  ws.addRow([`${yearName} 学年${info.college}学生综合素质测评班级情况登记表`]);
  ws.addRow([`专业：${info.major}            年级：${info.grade || ''}             班级：${info.classNo}         学生人数：${rows.length}`]);
  ws.addRow(ROW1_HEADERS);
  ws.addRow(ROW2_HEADERS);
  ws.mergeCells('A1:AI1');
  ws.mergeCells('A2:AI2');
  mergeTotalHeaders(ws, 3);
  rows.forEach((r, index) => ws.addRow(totalRow(r, index)));
  setDefaultWidths(ws, [6, 14, 10, 6, 10, 8, 8, 10, 14, 8, 10, 14, 8, 10, 8, 10, 14, 8, 10, 8, 10, 14, 8, 10, 8, 10, 14, 8, 10, 8, 10, 14, 8, 12, 8]);
  ws.views = [{ state: 'frozen', ySplit: 4 }];
  styleSheet(ws, 4);
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 22;
  return ws;
}

async function exportXLSX(res, rows, className, yearName, moduleConfig = null) {
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = '综测管理平台';

    if (moduleConfig) {
      addSingleModuleReportSheet(wb, moduleConfig, rows, className, yearName);
    } else {
      addTotalModuleSheet(wb, rows);
      addModuleSheet(wb, '德育',
        ['学号', '姓名', '基本评议得分', '加分', '扣分', '实际  合计', '换算素质分(×0.2)', '排名'],
        rows,
        r => [r.student_id, r.name, r.d1Base, r.d1Bonus, r.d1Deduct, r.d1Total, r.d1Weighted, r.d1Rank],
        'd1Rank'
      );
      addModuleSheet(wb, '智育',
        ['学号', '姓名', '实际  合计', '换算素质分(×0.4)', '排名'],
        rows,
        r => [r.student_id, r.name, r.d2Total, r.d2Weighted, r.d2Rank],
        'd2Rank'
      );
      addModuleSheet(wb, '体育',
        ['学号', '姓名', '基本分', '加分', '实际  合计', '换算素质分(×0.1)', '排名'],
        rows,
        r => [r.student_id, r.name, r.d3Base, r.d3Bonus, r.d3Total, r.d3Weighted, r.d3Rank],
        'd3Rank'
      );
      addModuleSheet(wb, '能力',
        ['学号', '姓名', '基  本   分', '加分', '实际  合计', '换算素质分(×0.1)', '排名'],
        rows,
        r => [r.student_id, r.name, r.d4Base, r.d4Bonus, r.d4Total, r.d4Weighted, r.d4Rank],
        'd4Rank'
      );
      addModuleSheet(wb, '美育',
        ['学号', '姓名', '基  本   分', '加分', '实际  合计', '换算素质分(×0.1)', '排名'],
        rows,
        r => [r.student_id, r.name, r.d5Base, r.d5Bonus, r.d5Total, r.d5Weighted, r.d5Rank],
        'd5Rank'
      );
      addModuleSheet(wb, '劳动',
        ['学号', '姓名', '基  本   分', '加分', '实际  合计', '换算素质分(×0.1)', '排名'],
        rows,
        r => [r.student_id, r.name, r.d6Base, r.d6Bonus, r.d6Total, r.d6Weighted, r.d6Rank],
        'd6Rank'
      );
      addComprehensiveSheet(wb, rows, className, yearName);
    }

    var filename = (className || '全部班级') + '_' + (moduleConfig ? moduleConfig.title + '单项成绩表' : '综合测评登分表') + '.xlsx';
    var buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename*=UTF-8\'\'' + encodeURIComponent(filename));
    res.send(buffer);
  } catch (err) {
    console.error('[XLSX]', err);
    res.status(500).json({ error: 'XLSX导出失败: ' + err.message });
  }
}

// ============ 前端展示用 JSON ============
exports.getScoreTable = async (req, res) => {
  try {
    const requestedGrade = String(req.query.grade || '').trim();
    const [className] = req.query.className ? await canonicalizeClassNames(pool, [String(req.query.className)]) : [''];
    const yearId = await getCurrentYearId(req.query.yearId || '');

    const studentRows = await getScoreTableStudents(req, className, requestedGrade, false);

    const rows = [];
    for (const s of studentRows) {
      const data = await calcStudentScoreTable(s.id, yearId);
      rows.push({ studentId: s.student_id, name: s.name, gender: s.gender || '', class_name: s.class_name, grade: s.grade, ...data });
    }
    rows.sort((a, b) => b.totalScore - a.totalScore);
    rows.forEach((r, i) => r.rank = i + 1);

    res.json({ rows, className, total: rows.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};
