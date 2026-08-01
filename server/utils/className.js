const CN_NUM = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9, 十: 10
};

function cnToNumber(text) {
  if (!text) return text;
  if (text === '十') return '10';
  if (text.startsWith('十')) return String(10 + (CN_NUM[text.slice(1)] || 0));
  if (text.endsWith('十')) return String((CN_NUM[text[0]] || 1) * 10);
  if (text.includes('十')) {
    const [a, b] = text.split('十');
    return String((CN_NUM[a] || 1) * 10 + (CN_NUM[b] || 0));
  }
  return String(CN_NUM[text] || text);
}

function toHalfWidthDigits(value) {
  return String(value || '').replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10));
}

function normalizeClassName(value) {
  let text = toHalfWidthDigits(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/（.*?）|\(.*?\)/g, '');

  text = text.replace(/([零一二两三四五六七八九十]+)班/g, (_m, num) => `${cnToNumber(num)}班`);
  // 年级由独立 grade 字段隔离，班级键只保留专业和班号。
  text = text.replace(/^20\d{2}(?:级|年级)?(?=[^\d])/, '');
  text = text.replace(/^\d{2}(?:级|年级)?(?=[^\d])/, '');
  return text;
}

function standardizeClassNameForDisplay(value) {
  let text = toHalfWidthDigits(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/（.*?）|\(.*?\)/g, '');
  text = text.replace(/([零一二两三四五六七八九十]+)班/g, (_m, num) => `${cnToNumber(num)}班`);
  text = text.replace(/^20\d{2}级?/, '');
  text = text.replace(/^\d{2}级?/, '');
  return text || String(value || '').trim();
}

function inferGradeFromClassName(className) {
  const text = toHalfWidthDigits(className).trim();
  const fullYear = text.match(/^20(\d{2})级?/);
  if (fullYear) return `20${fullYear[1]}级`;
  const shortYear = text.match(/^(\d{2})级?/);
  if (shortYear) return `20${shortYear[1]}级`;
  return '';
}

function inferGradeFromStudentId(studentId) {
  const text = String(studentId || '');
  const year = text.match(/^20\d{2}/);
  if (year) return `${year[0]}级`;
  const shortYear = text.match(/^(\d{2})\d{4,}/);
  return shortYear ? `20${shortYear[1]}级` : '';
}

function normalizeGrade(value) {
  const text = toHalfWidthDigits(value).trim().replace(/\s+/g, '');
  const fullYear = text.match(/^(20\d{2})/);
  if (fullYear) return `${fullYear[1]}级`;
  const shortYear = text.match(/^(\d{2})(?:级|年级)?$/);
  return shortYear ? `20${shortYear[1]}级` : text;
}

async function getKnownClassRows(pool) {
  const [rows] = await pool.query(
    `SELECT class_name, major, college_id FROM (
       SELECT class_name, major, college_id FROM class_options WHERE is_active = TRUE
       UNION
       SELECT class_name, major, college_id FROM students WHERE class_name IS NOT NULL AND class_name <> ''
     ) t
     WHERE class_name IS NOT NULL AND class_name <> ''`
  );
  return rows;
}

async function canonicalizeClassNames(pool, classNames) {
  const knownRows = await getKnownClassRows(pool);
  const byKey = new Map();
  knownRows.forEach(row => {
    const key = normalizeClassName(row.class_name);
    if (key && !byKey.has(key)) byKey.set(key, row.class_name);
  });

  return Array.from(new Set(
    (classNames || [])
      .map(name => String(name || '').trim())
      .filter(Boolean)
      .map(name => standardizeClassNameForDisplay(byKey.get(normalizeClassName(name)) || name))
  ));
}

async function resolveManagedClassNames(pool, teacherId) {
  const [assignedRows] = await pool.query('SELECT class_name FROM teacher_classes WHERE teacher_id = ?', [teacherId]);
  const assigned = assignedRows.map(row => row.class_name);
  if (assigned.length === 0) return [];

  const knownRows = await getKnownClassRows(pool);
  const byKey = new Map();
  for (const row of knownRows) {
    const key = normalizeClassName(row.class_name);
    if (key && !byKey.has(key)) byKey.set(key, row.class_name);
  }

  return Array.from(new Set(
    assigned
      .map(className => byKey.get(normalizeClassName(className)) || className)
      .map(standardizeClassNameForDisplay)
      .filter(Boolean)
  ));
}

async function resolveManagedClassScope(pool, teacher) {
  const classNames = teacher ? await resolveManagedClassNames(pool, teacher.id) : [];
  const configuredGrade = String((teacher && teacher.grade) || '').trim();
  if (classNames.length === 0) return { classNames: [], grade: configuredGrade, configuredGrade, inferredGrade: '', gradeMatched: false };

  const classKeys = new Set(classNames.map(normalizeClassName));
  const [studentRows] = await pool.query('SELECT class_name, grade FROM students WHERE class_name IS NOT NULL AND class_name <> ""');
  const grades = Array.from(new Set(
    studentRows
      .filter(row => classKeys.has(normalizeClassName(row.class_name)))
      .map(row => normalizeGrade(row.grade))
      .filter(Boolean)
  ));

  if (!configuredGrade) {
    return { classNames, grade: grades.length === 1 ? grades[0] : '', configuredGrade, inferredGrade: grades.length === 1 ? grades[0] : '', gradeMatched: grades.length === 1 };
  }
  const normalizedConfiguredGrade = normalizeGrade(configuredGrade);
  if (grades.includes(normalizedConfiguredGrade)) {
    return { classNames, grade: normalizedConfiguredGrade, configuredGrade: normalizedConfiguredGrade, inferredGrade: '', gradeMatched: true };
  }
  if (grades.length === 1) {
    return { classNames, grade: grades[0], configuredGrade: normalizedConfiguredGrade, inferredGrade: grades[0], gradeMatched: false };
  }
  return { classNames, grade: '', configuredGrade: normalizedConfiguredGrade, inferredGrade: '', gradeMatched: false };
}

module.exports = {
  normalizeClassName,
  normalizeGrade,
  standardizeClassNameForDisplay,
  canonicalizeClassNames,
  resolveManagedClassNames,
  resolveManagedClassScope,
  inferGradeFromClassName,
  inferGradeFromStudentId
};
