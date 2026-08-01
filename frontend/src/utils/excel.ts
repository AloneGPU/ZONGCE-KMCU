import { StudentScoreSummary, TeacherRecord, StudentRecord, BaseScores } from '../types';

type XlsxModule = typeof import('@e965/xlsx');
let xlsxPromise: Promise<XlsxModule> | null = null;

function loadXlsx(): Promise<XlsxModule> {
  if (!xlsxPromise) xlsxPromise = import('@e965/xlsx');
  return xlsxPromise;
}

function appendImportNotesSheet(XLSX: XlsxModule, workbook: any, notes: string[]) {
  const noteSheet = XLSX.utils.aoa_to_sheet([
    ['说明'],
    ['1. 第一张表中的“示例：”行仅用于参考，系统导入时会自动跳过，也可以手动删除。'],
    ...notes.map((note, index) => [`${index + 2}. ${note}`]),
  ]);
  noteSheet['!cols'] = [{ wch: 86 }];
  XLSX.utils.book_append_sheet(workbook, noteSheet, '填写说明');
}

/**
 * Export Comprehensive Score Summaries to Excel file
 */
export async function exportComprehensiveScoreExcel(
  summaries: StudentScoreSummary[],
  fileName: string = '数据科学与工程学院学生综合素质测评成绩汇总表(2025版).xlsx'
) {
  const XLSX = await loadXlsx();
  const data = summaries.map((s, index) => ({
    '序号': index + 1,
    '学年': s.academicYear,
    '学院': s.college,
    '年级': s.grade,
    '班级': s.majorClass,
    '学号': s.studentId,
    '姓名': s.studentName,
    '德育基础分': s.moralBase,
    '德育扣分': s.moralDeduction,
    '德育加分': s.moralBonus,
    '德育折算分': s.moralFinal,
    '智育': s.intellectualBase,
    '智育折算分': s.intellectualFinal,
    '体育基础分': s.physicalBase,
    '体育加分': s.physicalBonus,
    '体育折算分': s.physicalFinal,
    '能力加分': s.abilityBonus,
    '能力折算分': s.abilityFinal,
    '美育加分': s.aestheticsBonus,
    '美育折算分': s.aestheticsFinal,
    '劳动加分': s.laborBonus,
    '劳动折算分': s.laborFinal,
    '附加加分': s.extraBonus,
    '综合测评总分': s.totalScore,
    '测评等级': s.evaluationGrade,
    '评奖资格': s.isDisqualified ? '无(存在不及格项)' : '符合',
    '班级排名': `${s.classRank} / ${s.classTotal}`,
    '年级排名': `${s.gradeRank} / ${s.gradeTotal}`
  }));

  const worksheet = XLSX.utils.json_to_sheet(data);

  // Set column widths
  const cols = [
    { wch: 6 },  // 序号
    { wch: 12 }, // 学年
    { wch: 18 }, // 学院
    { wch: 8 },  // 年级
    { wch: 18 }, // 班级
    { wch: 14 }, // 学号
    { wch: 10 }, // 姓名
    { wch: 10 }, // 德育基础分
    { wch: 10 }, // 德育扣分
    { wch: 10 }, // 德育加分
    { wch: 10 }, // 德育折算分
    { wch: 12 }, // 智育
    { wch: 10 }, // 智育折算分
    { wch: 10 }, // 体育基础分
    { wch: 10 }, // 体育加分
    { wch: 10 }, // 体育折算分
    { wch: 10 }, // 能力加分
    { wch: 10 }, // 能力折算分
    { wch: 10 }, // 美育加分
    { wch: 10 }, // 美育折算分
    { wch: 10 }, // 劳动加分
    { wch: 10 }, // 劳动折算分
    { wch: 10 }, // 附加加分
    { wch: 14 }, // 综合测评总分
    { wch: 10 }, // 测评等级
    { wch: 16 }, // 评奖资格
    { wch: 12 }, // 班级排名
    { wch: 12 }, // 年级排名
  ];
  worksheet['!cols'] = cols;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '综测成绩表');
  XLSX.writeFile(workbook, fileName);
}

/**
 * Export specific section/module score tables (德育, 智育, 体育, 附加加分板块)
 */
export async function exportSectionScoreExcel(
  summaries: StudentScoreSummary[],
  section: 'all' | 'moral' | 'intellectual' | 'physical' | 'bonus',
  fileName: string = '综测单板块成绩单.xlsx'
) {
  if (section === 'all') {
    return await exportComprehensiveScoreExcel(summaries, fileName);
  }
  const XLSX = await loadXlsx();

  let data: any[] = [];
  let sheetName = '板块成绩单';
  let cols: any[] = [];

  if (section === 'moral') {
    sheetName = '德育单项表';
    data = summaries.map((s, idx) => ({
      '序号': idx + 1,
      '学号': s.studentId,
      '姓名': s.studentName,
      '专业班级': s.majorClass,
      '德育基础分 (满分100)': s.moralBase,
      '德育违纪扣分': s.moralDeduction,
      '日常行为/思政加分': s.moralBonus,
      '德育最终折算分 (占比20%)': s.moralFinal
    }));
    cols = [{ wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 22 }];
  } else if (section === 'intellectual') {
    sheetName = '智育素质单项表';
    data = summaries.map((s, idx) => ({
      '序号': idx + 1,
      '学号': s.studentId,
      '姓名': s.studentName,
      '专业班级': s.majorClass,
      '学业平均学分绩点(GPA)': s.intellectualBase,
      '竞赛科研/智育加分': s.intellectualBonus,
      '智育最终折算分 (占比60%)': s.intellectualFinal
    }));
    cols = [{ wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 22 }];
  } else if (section === 'physical') {
    sheetName = '体育单项表';
    data = summaries.map((s, idx) => ({
      '序号': idx + 1,
      '学号': s.studentId,
      '姓名': s.studentName,
      '专业班级': s.majorClass,
      '体测成绩基础分': s.physicalBase,
      '体育竞赛/打卡加分': s.physicalBonus,
      '体育最终折算分 (占比10%)': s.physicalFinal
    }));
    cols = [{ wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 16 }, { wch: 18 }, { wch: 22 }];
  } else if (section === 'bonus') {
    sheetName = '加分细项与折算表';
    data = summaries.map((s, idx) => ({
      '序号': idx + 1,
      '学号': s.studentId,
      '姓名': s.studentName,
      '专业班级': s.majorClass,
      '德育审核加分': s.moralBonus,
      '智育审核加分': s.intellectualBonus,
      '体育审核加分': s.physicalBonus,
      '能力发展加分': s.abilityBonus,
      '美育活动加分': s.aestheticsBonus,
      '劳动实践加分': s.laborBonus,
      '特别附加分': s.extraBonus,
      '加分合计得分': s.moralBonus + s.intellectualBonus + s.physicalBonus + s.abilityBonus + s.aestheticsBonus + s.laborBonus + s.extraBonus
    }));
    cols = [{ wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }];
  }

  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = cols;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, fileName);
}

/**
 * Generate and download Excel import template for Teachers
 */
export async function downloadTeacherImportTemplate() {
  const XLSX = await loadXlsx();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['学院', '年级', '工号', '姓名', '邮箱', '密码', '负责班级'],
    ['示例：数据科学与工程学院', '示例：2024级', '示例：007', '示例：张老师', '示例：teacher@example.com', '示例：123456', '示例：物联网工程1班,人工智能1班'],
  ]);
  worksheet['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 26 }, { wch: 12 }, { wch: 36 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '教师导入模板');
  appendImportNotesSheet(XLSX, workbook, [
    '工号、姓名必填；邮箱建议填写，用于辅导员修改密码和忘记密码验证码。',
    '密码可不填，不填时使用系统默认初始密码。',
    '负责班级可用英文逗号、中文逗号或顿号分隔，例如 物联网工程1班,人工智能1班。',
    '年级建议使用 2024级；负责班级建议先在班级管理中维护。'
  ]);
  XLSX.writeFile(workbook, '教师导入模板.xlsx');
}

/**
 * Generate template for class options import
 */
export async function downloadClassOptionImportTemplate() {
  const XLSX = await loadXlsx();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['学院', '年级', '专业', '班级', '辅导员工号（可选）'],
    ['示例：数据科学与工程学院', '示例：2024级', '示例：物联网工程', '示例：物联网工程1班', '示例：007'],
    ['示例：数据科学与工程学院', '示例：2024级', '示例：人工智能', '示例：人工智能1班', ''],
  ]);
  worksheet['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 18 }, { wch: 24 }, { wch: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '班级导入模板');
  appendImportNotesSheet(XLSX, workbook, [
    '年级请填写标准格式，例如 2024级。',
    '班级请填写标准班级名称，例如 物联网工程1班。',
    '辅导员工号可不填，留空则只导入班级，不绑定辅导员。',
    '导入后会按数据库中已有的班级选项进行去重和覆盖。'
  ]);
  XLSX.writeFile(workbook, '班级管理导入模板.xlsx');
}

/**
 * Generate and download Excel import template for Students
 */
export async function downloadStudentImportTemplate() {
  const XLSX = await loadXlsx();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['学号', '姓名', '性别', '年级', '专业班级', '学院', '辅导员姓名', '密码'],
    ['示例：24170025', '示例：张三', '示例：男', '示例：2024级', '示例：物联网工程1班', '示例：数据科学与工程学院', '示例：张老师', '示例：123456'],
  ]);
  worksheet['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 24 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '学生导入模板');
  appendImportNotesSheet(XLSX, workbook, [
    '学号、姓名、年级必填；密码可不填，不填时使用系统默认初始密码。',
    '专业班级建议使用班级管理中的标准名称，例如 物联网工程1班。',
    '学号前两位会用于辅助推断年级，例如 24 开头对应 2024级。'
  ]);
  XLSX.writeFile(workbook, '学生导入模板.xlsx');
}

/**
 * Export Students Roster to Excel
 */
export async function exportStudentRosterExcel(students: StudentRecord[], fileName: string = '学生名册.xlsx') {
  const XLSX = await loadXlsx();
  const data = students.map((s, idx) => ({
    '序号': idx + 1,
    '学号': s.studentId,
    '姓名': s.name,
    '性别': s.gender || '',
    '年级': s.grade,
    '专业班级': s.majorClass,
    '学院': s.college
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 22 }, { wch: 22 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '学生名册');
  XLSX.writeFile(workbook, fileName);
}

/**
 * Export Teachers Roster to Excel
 */
export async function exportTeacherRosterExcel(teachers: TeacherRecord[], fileName: string = '教师名册.xlsx') {
  const XLSX = await loadXlsx();
  const data = teachers.map((t, idx) => ({
    '序号': idx + 1,
    '工号': t.teacherId,
    '姓名': t.name,
    '邮箱': t.email || '',
    '职称/职务': t.title,
    '负责年级': t.grade,
    '学院': t.college,
    '负责班级': (t.classes || []).join(',')
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 12 }, { wch: 26 }, { wch: 14 }, { wch: 10 }, { wch: 22 }, { wch: 36 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '教师名册');
  XLSX.writeFile(workbook, fileName);
}

/**
 * Export Material Audit Records to Excel
 */
export async function exportMaterialAuditRecordsExcel(materials: any[], fileName: string = '综测加分材料审核明细表.xlsx') {
  const XLSX = await loadXlsx();
  const data = materials.map((m, idx) => ({
    '序号': idx + 1,
    '学号': m.studentId,
    '申报学生': m.studentName,
    '加分分类': m.categoryName,
    '项目名称': m.title,
    '拟加分数': m.score,
    '审核状态': m.status === 'approved' ? '已核准通过' : m.status === 'rejected' ? '被退回' : '待初审/待审核',
    '审核人': m.reviewer || '系统/初审员',
    '驳回/退回原因': m.rejectReason || '无'
  }));
  const worksheet = XLSX.utils.json_to_sheet(data);
  worksheet['!cols'] = [{ wch: 6 }, { wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 24 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '材料审核明细');
  XLSX.writeFile(workbook, fileName);
}

/**
 * Generate template for base scores import (德育/智育/体育)
 */
export async function downloadScoreImportTemplate(scoreType: 'moral' | 'intellectual' | 'physical') {
  const XLSX = await loadXlsx();
  const labelMap = {
    moral: '德育基础分表',
    intellectual: '智育表',
    physical: '体质自测成绩表'
  };
  const scoreColumn = {
    moral: '德育基础分(0-100)',
    intellectual: '智育百分制',
    physical: '体育/体测成绩(0-100)'
  }[scoreType];

  const worksheet = XLSX.utils.aoa_to_sheet([
    ['学号', '姓名', '年级', '专业班级', scoreColumn],
    ['示例：24170025', '示例：张三', '示例：2024级', '示例：物联网工程1班', '示例：86'],
  ]);
  worksheet['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 20 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, labelMap[scoreType]);
  appendImportNotesSheet(XLSX, workbook, [
    '学号必填，成绩列必须为数字。',
    '成绩列可以保留模板表头，也可以命名为 成绩、分数、基础成绩、板块名称或具体导入项目名称。',
    '重复导入同一学生、同一学年、同一项目会覆盖原成绩，不会重复累计。'
  ]);
  XLSX.writeFile(workbook, `${labelMap[scoreType]}模板.xlsx`);
}

/**
 * Parse uploaded file (xlsx or csv) to JSON array
 */
export async function parseExcelFile<T = any>(file: File): Promise<T[]> {
  const allowedExtensions = new Set(['xlsx', 'xls', 'csv']);
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const maxFileSize = 10 * 1024 * 1024;
  const maxRows = 5000;
  const maxCellLength = 10000;

  if (!allowedExtensions.has(extension)) {
    throw new Error('仅支持 .xlsx、.xls 或 .csv 文件');
  }
  if (file.size <= 0) throw new Error('文件为空');
  if (file.size > maxFileSize) throw new Error('文件不能超过 10MB');

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const XLSX = await loadXlsx();
        const workbook = XLSX.read(data, { type: 'array', dense: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) throw new Error('文件中没有可读取的工作表');
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json<T>(worksheet, { defval: '' });
        if (jsonData.length === 0) throw new Error('工作表中没有数据');
        if (jsonData.length > maxRows) throw new Error(`单次最多导入 ${maxRows} 行数据`);
        for (const row of jsonData as Record<string, unknown>[]) {
          for (const value of Object.values(row)) {
            if (typeof value === 'string' && value.length > maxCellLength) {
              throw new Error('工作表中存在内容过长的单元格');
            }
          }
        }
        resolve(jsonData);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsArrayBuffer(file);
  });
}
