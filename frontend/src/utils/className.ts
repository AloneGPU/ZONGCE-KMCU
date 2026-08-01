const CN_NUM: Record<string, number> = {
  '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

function cnToNumber(text: string) {
  if (!text) return text;
  if (text === '十') return '10';
  if (text.startsWith('十')) return String(10 + (CN_NUM[text.slice(1)] || 0));
  if (text.endsWith('十')) return String((CN_NUM[text[0]] || 1) * 10);
  if (text.includes('十')) {
    const [a, b] = text.split('十');
    return String((CN_NUM[a] || 1) * 10 + (CN_NUM[b] || 0));
  }
  return String(CN_NUM[text] ?? text);
}

function toHalfWidthDigits(value: unknown) {
  return String(value || '').replace(/[０-９]/g, ch => String(ch.charCodeAt(0) - 0xff10));
}

export function normalizeGrade(value: unknown) {
  const text = toHalfWidthDigits(value).trim().replace(/\s+/g, '');
  const fullYear = text.match(/^(20\d{2})/);
  if (fullYear) return `${fullYear[1]}级`;
  const shortYear = text.match(/^(\d{2})(?:级|年级)?$/);
  return shortYear ? `20${shortYear[1]}级` : text;
}

export function inferGradeFromClassName(value: unknown) {
  const text = toHalfWidthDigits(value).trim().replace(/\s+/g, '');
  const fullYear = text.match(/^20(\d{2})(?:级|年级)?(?=[^\d])/);
  if (fullYear) return `20${fullYear[1]}级`;
  const shortYear = text.match(/^(\d{2})(?:级|年级)?(?=[^\d])/);
  return shortYear ? `20${shortYear[1]}级` : '';
}

export function inferGradeFromStudentId(value: unknown) {
  const text = toHalfWidthDigits(value).trim();
  const fullYear = text.match(/^(20\d{2})/);
  if (fullYear) return `${fullYear[1]}级`;
  const shortYear = text.match(/^(\d{2})\d{4,}/);
  return shortYear ? `20${shortYear[1]}级` : '';
}

export function normalizeClassName(value: unknown) {
  let text = toHalfWidthDigits(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/（.*?）|\(.*?\)/g, '');

  text = text.replace(/([零一二两三四五六七八九十]+)班/g, (_match, number) => `${cnToNumber(number)}班`);
  text = text.replace(/^20\d{2}(?:级|年级)?(?=[^\d])/, '');
  text = text.replace(/^\d{2}(?:级|年级)?(?=[^\d])/, '');
  return text.toLowerCase();
}

export function resolveStudentGrade(grade: unknown, className?: unknown, studentId?: unknown) {
  return normalizeGrade(grade) || inferGradeFromClassName(className) || inferGradeFromStudentId(studentId);
}

export function classScopeKey(className: unknown, grade?: unknown, studentId?: unknown) {
  return `${resolveStudentGrade(grade, className, studentId) || 'unknown'}__${normalizeClassName(className)}`;
}

export function sameClassScope(
  leftClass: unknown,
  leftGrade: unknown,
  rightClass: unknown,
  rightGrade: unknown,
  leftStudentId?: unknown,
  rightStudentId?: unknown,
) {
  if (!normalizeClassName(leftClass) || normalizeClassName(leftClass) !== normalizeClassName(rightClass)) return false;
  const leftResolvedGrade = resolveStudentGrade(leftGrade, leftClass, leftStudentId);
  const rightResolvedGrade = resolveStudentGrade(rightGrade, rightClass, rightStudentId);
  return !leftResolvedGrade || !rightResolvedGrade || leftResolvedGrade === rightResolvedGrade;
}
