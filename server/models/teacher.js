const pool = require('../config/database');
const { canonicalizeClassNames, standardizeClassNameForDisplay } = require('../utils/className');

async function normalizeTeacherRow(row) {
  if (!row) return null;
  if (row.classes) row.classes = String(row.classes).split(',').filter(Boolean).map(standardizeClassNameForDisplay);
  else row.classes = [];
  return row;
}

const Teacher = {
  async findAll() {
    const [rows] = await pool.query(
      `SELECT t.*, c.name as college_name, u.email,
        (SELECT GROUP_CONCAT(tc.class_name) FROM teacher_classes tc WHERE tc.teacher_id = t.id) as classes
       FROM teachers t
       LEFT JOIN colleges c ON t.college_id = c.id
       LEFT JOIN users u ON u.id = t.user_id
       ORDER BY t.employee_id`
    );
    return rows.map(r => ({ ...r, classes: r.classes ? r.classes.split(',').map(standardizeClassNameForDisplay) : [] }));
  },

  async findByUserId(userId) {
    const [users] = await pool.query('SELECT id, account, name FROM users WHERE id = ?', [userId]);
    const user = users[0] || null;
    if (!user) return null;

    const [rows] = await pool.query(
      `SELECT t.*, c.name as college_name, u.email,
        (SELECT GROUP_CONCAT(tc.class_name) FROM teacher_classes tc WHERE tc.teacher_id = t.id) as classes
       FROM teachers t LEFT JOIN colleges c ON t.college_id = c.id
       LEFT JOIN users u ON u.id = t.user_id
       WHERE t.user_id = ? OR t.employee_id = ?
       ORDER BY CASE WHEN t.user_id = ? THEN 0 ELSE 1 END
       LIMIT 1`, [userId, user.account, userId]
    );
    let r = rows[0] || null;

    if (!r) {
      const [nameMatches] = await pool.query(
        `SELECT t.*, c.name as college_name, u.email,
          (SELECT GROUP_CONCAT(tc.class_name) FROM teacher_classes tc WHERE tc.teacher_id = t.id) as classes
         FROM teachers t LEFT JOIN colleges c ON t.college_id = c.id
         LEFT JOIN users u ON u.id = t.user_id
         WHERE t.name = ?
         LIMIT 2`,
        [user.name]
      );
      if (nameMatches.length === 1) r = nameMatches[0];
    }

    if (!r) {
      const [cols] = await pool.query('SELECT id FROM colleges ORDER BY id LIMIT 1');
      const collegeId = cols[0] ? cols[0].id : 1;
      try {
        const [result] = await pool.query(
          `INSERT INTO teachers (employee_id, name, college_id, grade, user_id)
           VALUES (?, ?, ?, '', ?)`,
          [user.account, user.name || user.account, collegeId, userId]
        );
        const [created] = await pool.query(
          `SELECT t.*, c.name as college_name, u.email,
            (SELECT GROUP_CONCAT(tc.class_name) FROM teacher_classes tc WHERE tc.teacher_id = t.id) as classes
           FROM teachers t LEFT JOIN colleges c ON t.college_id = c.id
           LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
          [result.insertId]
        );
        r = created[0] || null;
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          const [dupe] = await pool.query(
            `SELECT t.*, c.name as college_name, u.email,
              (SELECT GROUP_CONCAT(tc.class_name) FROM teacher_classes tc WHERE tc.teacher_id = t.id) as classes
             FROM teachers t LEFT JOIN colleges c ON t.college_id = c.id
             LEFT JOIN users u ON u.id = t.user_id WHERE t.employee_id = ? LIMIT 1`,
            [user.account]
          );
          r = dupe[0] || null;
        } else {
          throw err;
        }
      }
    }

    if (r && Number(r.user_id || 0) !== Number(userId)) {
      await pool.query('UPDATE teachers SET user_id = ? WHERE id = ?', [userId, r.id]);
      r.user_id = userId;
    }
    return normalizeTeacherRow(r);
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT t.*, c.name as college_name, u.email FROM teachers t
       LEFT JOIN colleges c ON t.college_id = c.id
       LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`, [id]
    );
    return rows[0] || null;
  },

  async create({ employeeId, name, collegeId, grade, userId }) {
    const [result] = await pool.query(
      `INSERT INTO teachers (employee_id, name, college_id, grade, user_id)
       VALUES (?, ?, ?, ?, ?)`,
      [employeeId, name, collegeId, grade, userId]
    );
    return { id: result.insertId, employee_id: employeeId, name, college_id: collegeId, grade, user_id: userId };
  },

  async setClasses(teacherId, classNames) {
    const raw = Array.from(new Set(
      (classNames || []).map(cn => String(cn || '').trim()).filter(Boolean)
    ));
    const normalized = await canonicalizeClassNames(pool, raw);
    await pool.query('DELETE FROM teacher_classes WHERE teacher_id = ?', [teacherId]);
    for (const cn of normalized) {
      await pool.query('INSERT INTO teacher_classes (teacher_id, class_name) VALUES (?, ?)', [teacherId, cn]);
    }
  },

  async delete(id) {
    await pool.query('DELETE FROM teachers WHERE id = ?', [id]);
  },

  async bulkCreate(teachers) {
    const results = [];
    for (const t of teachers) {
      const [result] = await pool.query(
        `INSERT INTO teachers (employee_id, name, college_id, grade)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), college_id = VALUES(college_id), grade = VALUES(grade)`,
        [t.employeeId, t.name, t.collegeId, t.grade]
      );
      results.push({ id: result.insertId, ...t });
    }
    return results;
  },
};

module.exports = Teacher;
