const pool = require('../config/database');
const { normalizeClassName, standardizeClassNameForDisplay } = require('../utils/className');

function displayStudent(row) {
  if (!row) return row;
  return {
    ...row,
    class_name: standardizeClassNameForDisplay(row.class_name),
  };
}

function aggregateClassStats(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const className = standardizeClassNameForDisplay(row.class_name);
    const key = [row.college_id || '', row.college_name || '', row.major || '', className, row.grade || ''].join('|');
    const current = byKey.get(key) || { ...row, class_name: className, total: 0 };
    current.total += Number(row.total || 0);
    byKey.set(key, current);
  }
  return Array.from(byKey.values()).sort((a, b) => b.total - a.total);
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function textMatches(value, query, exact) {
  const source = normalizeText(value);
  const target = normalizeText(query);
  if (!target) return true;
  return exact ? source === target : source.includes(target);
}

function classMatches(value, query, exact) {
  const source = normalizeClassName(value);
  const target = normalizeClassName(query);
  if (!target) return true;
  return exact ? source === target : source.includes(target) || target.includes(source);
}

const Student = {
  async findAll(filters) {
    filters = filters || {};
    let sql = `SELECT s.*, c.name as college_name, u.account
       FROM students s
       LEFT JOIN colleges c ON s.college_id = c.id
       LEFT JOIN users u ON s.user_id = u.id
       WHERE 1=1`;
    const params = [];

    if (filters.collegeId) { sql += ' AND s.college_id = ?'; params.push(filters.collegeId); }
    if (filters.grade)     { sql += ' AND s.grade = ?'; params.push(filters.grade); }

    sql += ' ORDER BY s.college_id, s.major, s.class_name, s.student_id';
    const [rows] = await pool.query(sql, params);
    const exact = filters.matchMode === 'exact';
    return rows.map(displayStudent).filter(row => {
      if (filters.major && !textMatches(row.major, filters.major, exact)) return false;
      if (filters.className && !classMatches(row.class_name, filters.className, true)) return false;
      if (filters.keyword) {
        const fields = [
          row.student_id,
          row.name,
          row.grade,
          row.major,
          row.class_name,
          row.college_name,
          row.counselor_name,
          row.gender,
          row.account,
        ];
        const normalHit = fields.some(field => textMatches(field, filters.keyword, exact));
        const classHit = classMatches(row.class_name, filters.keyword, exact);
        if (!normalHit && !classHit) return false;
      }
      return true;
    });
  },

  // 学院/专业/班级 统计
  async getStats() {
    const [byCollege] = await pool.query(
      `SELECT c.id as college_id, c.name as college_name, COUNT(*) as total
       FROM students s JOIN colleges c ON s.college_id = c.id GROUP BY c.id, c.name ORDER BY total DESC`
    );
    const [byMajor] = await pool.query(
      `SELECT s.college_id, c.name as college_name, s.major, COUNT(*) as total
       FROM students s JOIN colleges c ON s.college_id = c.id WHERE s.major != '' GROUP BY s.college_id, c.name, s.major ORDER BY total DESC`
    );
    const [byClass] = await pool.query(
      `SELECT s.college_id, c.name as college_name, s.major, s.class_name, s.grade, COUNT(*) as total
       FROM students s JOIN colleges c ON s.college_id = c.id WHERE s.class_name != '' GROUP BY s.college_id, c.name, s.major, s.class_name, s.grade ORDER BY total DESC`
    );
    return { byCollege, byMajor, byClass: aggregateClassStats(byClass) };
  },

  async findByClass(className) {
    const [rows] = await pool.query(
      `SELECT s.*, c.name as college_name FROM students s
       LEFT JOIN colleges c ON s.college_id = c.id
       ORDER BY s.student_id`
    );
    const requestedKey = normalizeClassName(className);
    return rows.map(displayStudent).filter(row => normalizeClassName(row.class_name) === requestedKey);
  },

  async findByCollege(collegeId) {
    const [rows] = await pool.query(
      `SELECT s.*, c.name as college_name FROM students s
       LEFT JOIN colleges c ON s.college_id = c.id
       WHERE s.college_id = ? ORDER BY s.class_name, s.student_id`, [collegeId]
    );
    return rows.map(displayStudent);
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT s.*, c.name as college_name FROM students s
       LEFT JOIN colleges c ON s.college_id = c.id WHERE s.id = ?`, [id]
    );
    return displayStudent(rows[0] || null);
  },

  async findByUserId(userId) {
    const [rows] = await pool.query(
      `SELECT s.*, c.name as college_name FROM students s
       LEFT JOIN colleges c ON s.college_id = c.id WHERE s.user_id = ?`, [userId]
    );
    return displayStudent(rows[0] || null);
  },

  async create({ studentId, name, grade, major, className, collegeId, userId, gender, counselorName }) {
    const [result] = await pool.query(
      `INSERT INTO students (student_id, name, grade, major, class_name, college_id, user_id, gender, counselor_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [studentId, name, grade, major, className, collegeId, userId, gender || null, counselorName || null]
    );
    return { id: result.insertId, student_id: studentId, name, grade, major, class_name: className, college_id: collegeId, user_id: userId, gender: gender || null, counselor_name: counselorName || null };
  },

  async delete(id) {
    await pool.query('DELETE FROM students WHERE id = ?', [id]);
  },

  async bulkCreate(students) {
    const results = [];
    for (const s of students) {
      const [result] = await pool.query(
        `INSERT INTO students (student_id, name, grade, major, class_name, college_id, counselor_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), grade = VALUES(grade), major = VALUES(major), class_name = VALUES(class_name), counselor_name = VALUES(counselor_name)`,
        [s.studentId, s.name, s.grade, s.major, s.className, s.collegeId, s.counselorName || null]
      );
      results.push({ id: result.insertId, ...s });
    }
    return results;
  },
};

module.exports = Student;
