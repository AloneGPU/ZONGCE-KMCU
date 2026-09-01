const pool = require('../config/database');
const { normalizeClassName, normalizeGrade, standardizeClassNameForDisplay } = require('../utils/className');

// 模块基础分从 scoring_modules.base_score 读取(可配置),进程内缓存。
// 旧库未跑迁移时按原有硬编码规则兜底: 德育(1)/能力(4)/美育(5)/劳动(6) = 60。
const BASE_SCORE_FALLBACK = new Map([
  [1, 60], [4, 60], [5, 60], [6, 60],
]);
let baseScoreCache = null;
let baseScoreReady = null;

async function ensureBaseScores() {
  if (baseScoreReady) return baseScoreReady;
  baseScoreReady = (async () => {
    try {
      const [rows] = await pool.query('SELECT id, base_score FROM scoring_modules');
      baseScoreCache = new Map(rows.map(r => [Number(r.id), Number(r.base_score) || 0]));
    } catch (err) {
      // 旧库没有 base_score 列时沿用历史规则，避免迁移前启动即崩溃
      baseScoreCache = new Map(BASE_SCORE_FALLBACK);
    }
  })();
  return baseScoreReady;
}

// 同步读取，调用方需先 await ensureBaseScores()
function moduleBaseScore(moduleId) {
  if (baseScoreCache) return baseScoreCache.get(Number(moduleId)) ?? 0;
  return BASE_SCORE_FALLBACK.get(Number(moduleId)) ?? 0;
}

function capImportedScore(moduleId, score) {
  const value = Number(score) || 0;
  return Number(moduleId) === 3 ? Math.min(value, 60) : value;
}

async function invalidateBaseScores() {
  baseScoreReady = null;
  baseScoreCache = null;
}

const Score = {
  async getImported(studentId, yearId, moduleId) {
    const [rows] = await pool.query(
      `SELECT item_id, score FROM imported_scores
       WHERE student_id = ? AND academic_year_id = ? AND module_id = ?`,
      [studentId, yearId, moduleId]
    );
    return rows;
  },

  async importScores(scores, importedBy) {
    const results = [];
    for (const s of scores) {
      const [result] = await pool.query(
        `INSERT INTO imported_scores (student_id, academic_year_id, module_id, item_id, score, imported_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE score = VALUES(score), imported_by = VALUES(imported_by)`,
        [s.studentId, s.academicYearId, s.moduleId, s.itemId, s.score, importedBy]
      );
      results.push({ id: result.insertId, ...s });
    }
    return results;
  },

  async calcModuleScore(studentId, yearId, moduleId) {
    const [rows] = await pool.query(
      `SELECT
        COALESCE((SELECT SUM(score) FROM submissions
         WHERE student_id = ? AND academic_year_id = ? AND module_id = ? AND status = 'approved'), 0)
        +
        COALESCE((SELECT SUM(score) FROM imported_scores
         WHERE student_id = ? AND academic_year_id = ? AND module_id = ?), 0)
       AS total`,
      [studentId, yearId, moduleId, studentId, yearId, moduleId]
    );
    return parseFloat(rows[0].total) || 0;
  },

  async calcModuleBreakdown(studentId, yearId, moduleId) {
    const [rows] = await pool.query(
      `SELECT
        COALESCE((SELECT SUM(score) FROM submissions
         WHERE student_id = ? AND academic_year_id = ? AND module_id = ? AND status = 'approved'), 0) AS approvedScore,
        COALESCE((SELECT SUM(score) FROM imported_scores
         WHERE student_id = ? AND academic_year_id = ? AND module_id = ?), 0) AS importedScore`,
      [studentId, yearId, moduleId, studentId, yearId, moduleId]
    );
    const approvedScore = parseFloat(rows[0].approvedScore) || 0;
    const importedScore = parseFloat(rows[0].importedScore) || 0;
    const cappedImportedScore = capImportedScore(moduleId, importedScore);
    return { approvedScore, importedScore: cappedImportedScore, total: approvedScore + cappedImportedScore };
  },

  // V2 六模块综测总分公式:
  // 德育 = (60 + 加分 - 扣分) × 0.2
  // 智育 = 学业成绩(教务加权平均) × 0.4
  // 体育 = (体育基础 + 竞赛加分) × 0.1
  // 能力 = (60 + 加分) × 0.1
  // 美育 = (60 + 加分) × 0.1
  // 劳动 = (60 + 加分) × 0.1
  async calcTotalScore(studentId, yearId) {
    const [modRows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    await ensureBaseScores();
    let total = 0;

    for (const mod of modRows) {
      const breakdown = await this.calcModuleBreakdown(studentId, yearId, mod.id);
      let modScore = breakdown.total;
      modScore = modScore + moduleBaseScore(mod.id);
      total += modScore * parseFloat(mod.weight) / 100;
    }

    return Math.round(total * 100) / 100;
  },

  async getRankings(yearId, className, grade) {
    let studentRows;
    if (className) {
      [studentRows] = await pool.query(
        'SELECT s.* FROM students s ORDER BY s.student_id'
      );
      const classKey = normalizeClassName(className);
      studentRows = studentRows.filter(student =>
        normalizeClassName(student.class_name) === classKey &&
        (!grade || normalizeGrade(student.grade) === normalizeGrade(grade))
      );
    } else {
      [studentRows] = await pool.query('SELECT s.* FROM students s ORDER BY s.class_name, s.student_id');
      if (grade) studentRows = studentRows.filter(student => normalizeGrade(student.grade) === normalizeGrade(grade));
    }

    if (studentRows.length === 0) return [];

    // 一次性按 (学生, 模块) 聚合所有得分，避免对每个学生逐个模块查询（N+1）
    const [scoreRows] = await pool.query(
      `SELECT student_id, module_id,
              SUM(approved_score) AS approvedScore,
              SUM(imported_score) AS importedScore,
              SUM(approved_score + imported_score) AS total
       FROM (
         SELECT student_id, module_id, score AS approved_score, 0 AS imported_score FROM submissions
         WHERE academic_year_id = ? AND status = 'approved'
         UNION ALL
         SELECT student_id, module_id, 0 AS approved_score, score AS imported_score FROM imported_scores
         WHERE academic_year_id = ?
       ) combined
       GROUP BY student_id, module_id`,
      [yearId, yearId]
    );
    const scoreMap = new Map();
    for (const row of scoreRows) {
      scoreMap.set(`${row.student_id}:${row.module_id}`, {
        approvedScore: parseFloat(row.approvedScore) || 0,
        importedScore: capImportedScore(row.module_id, row.importedScore),
        total: (parseFloat(row.approvedScore) || 0) + capImportedScore(row.module_id, row.importedScore),
      });
    }

    const [modRows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    await ensureBaseScores();
    const rankings = [];

    for (const student of studentRows) {
      const moduleScores = [];
      let total = 0;
      for (const mod of modRows) {
        const breakdown = scoreMap.get(`${student.id}:${mod.id}`) || { approvedScore: 0, importedScore: 0, total: 0 };
        const score = breakdown.total;
        const baseScore = moduleBaseScore(mod.id);
        // 明细里同时给出原始加分与最终折算分，前端不再自行推算基础分
        moduleScores.push({
          moduleId: mod.id,
          moduleName: mod.name,
          score,
          approvedScore: breakdown.approvedScore,
          importedScore: breakdown.importedScore,
          baseScore,
          finalScore: score + baseScore,
        });
        total += (score + baseScore) * parseFloat(mod.weight) / 100;
      }
      rankings.push({
        studentId: student.id,
        studentCode: student.student_id,
        studentName: student.name,
        className: standardizeClassNameForDisplay(student.class_name),
        grade: student.grade,
        major: student.major,
        totalScore: Math.round(total * 100) / 100,
        modules: moduleScores,
      });
    }

    rankings.sort((a, b) => b.totalScore - a.totalScore);
    rankings.forEach((r, i) => r.rank = i + 1);
    return rankings;
  },

  async getDashboardStats(yearId) {
    const [students] = await pool.query('SELECT COUNT(*) as count FROM students');
    const [teachers] = await pool.query('SELECT COUNT(*) as count FROM teachers');
    const [pending] = await pool.query('SELECT COUNT(*) as count FROM submissions WHERE academic_year_id = ? AND status = ?', [yearId, 'pending']);
    const [approved] = await pool.query('SELECT COUNT(*) as count FROM submissions WHERE academic_year_id = ? AND status = ?', [yearId, 'approved']);
    const [classes] = await pool.query('SELECT COUNT(DISTINCT class_name) as count FROM students');
    return {
      totalStudents: students[0].count,
      totalTeachers: teachers[0].count,
      pendingSubmissions: pending[0].count,
      approvedSubmissions: approved[0].count,
      totalClasses: classes[0].count,
    };
  },
};

module.exports = Score;
Score.moduleBaseScore = moduleBaseScore;
Score.ensureBaseScores = ensureBaseScores;
Score.invalidateBaseScores = invalidateBaseScores;
