const pool = require('../config/database');
const { normalizeClassName, normalizeGrade, standardizeClassNameForDisplay } = require('../utils/className');

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

  // V2 六模块综测总分公式:
  // 德育 = (60 + 加分 - 扣分) × 0.2
  // 智育 = 学业成绩(教务加权平均) × 0.4
  // 体育 = (体育基础 + 竞赛加分) × 0.1
  // 能力 = (60 + 加分) × 0.1
  // 美育 = (60 + 加分) × 0.1
  // 劳动 = (60 + 加分) × 0.1
  async calcTotalScore(studentId, yearId) {
    const [modRows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    let total = 0;
    // 有60分基础分的模块: 德育(1), 能力(4), 美育(5), 劳动(6)
    const base60Modules = [1, 4, 5, 6];

    for (const mod of modRows) {
      let modScore = await this.calcModuleScore(studentId, yearId, mod.id);
      // 德育/能力/美育/劳动 有60分基础
      if (base60Modules.includes(mod.id)) {
        modScore = 60 + modScore;
      }
      // 体育已有实际分数不需要基础分; 智育为教务加权平均
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

    const [modRows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    const rankings = [];

    for (const student of studentRows) {
      const totalScore = await this.calcTotalScore(student.id, yearId);
      const moduleScores = [];
      for (const mod of modRows) {
        const ms = await this.calcModuleScore(student.id, yearId, mod.id);
        moduleScores.push({ moduleId: mod.id, moduleName: mod.name, score: ms });
      }
      rankings.push({
        studentId: student.id,
        studentCode: student.student_id,
        studentName: student.name,
        className: standardizeClassNameForDisplay(student.class_name),
        grade: student.grade,
        major: student.major,
        totalScore,
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
