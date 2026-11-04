const pool = require('../config/database');
const Teacher = require('./teacher');

const User = {
  async findByAccount(account) {
    const [rows] = await pool.query(
      `SELECT u.*, c.name AS college_name
       FROM users u LEFT JOIN colleges c ON c.id = u.college_id
       WHERE u.account = ?`, [account]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT u.id, u.account, u.role, u.college_id, c.name AS college_name,
              u.name, u.email, u.token_version, u.created_at
       FROM users u LEFT JOIN colleges c ON c.id = u.college_id
       WHERE u.id = ?`, [id]
    );
    return rows[0] || null;
  },

  async getFullInfo(userId, _role /* 仅作参考，实际以数据库为准 */) {
    const user = await this.findById(userId);
    if (!user) return null;

    // 使用数据库中的实际角色（而非 JWT 中的旧角色），防止角色变更后信息错位
    const actualRole = user.role;

    if (actualRole === 'counselor') {
      const info = await Teacher.findByUserId(userId);
      return { ...user, teacherInfo: info };
    }

    // 学生和班委统一处理（role 均为 'student'，班委通过 is_assistant 区分）
    if (actualRole === 'student') {
      const [rows] = await pool.query(
        `SELECT s.*, c.name as college_name
         FROM students s LEFT JOIN colleges c ON s.college_id = c.id
         WHERE s.user_id = ?`, [userId]
      );
      const info = rows[0] || null;
      return { ...user, isAssistant: info && info.is_assistant ? true : false, studentInfo: info };
    }

    return user;
  },

  async create({ account, passwordHash, role, name, email, collegeId }) {
    const [result] = await pool.query(
      'INSERT INTO users (account, password_hash, role, college_id, name, email) VALUES (?, ?, ?, ?, ?, ?)',
      [account, passwordHash, role, collegeId || null, name, email || null]
    );
    return { id: result.insertId, account, role, college_id: collegeId || null, name, email: email || null };
  },

  async updatePassword(userId, newHash) {
    await pool.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [newHash, userId]);
  },
};

module.exports = User;
