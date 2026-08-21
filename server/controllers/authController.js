const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn } = require('../config/auth');
const User = require('../models/user');
const Student = require('../models/student');
const Teacher = require('../models/teacher');
const pool = require('../config/database');
const { sendVerificationCode } = require('../utils/email');
const {
  inferGradeFromClassName,
  inferGradeFromStudentId,
  normalizeClassName,
  normalizeGrade,
  standardizeClassNameForDisplay
} = require('../utils/className');

function isStudentId(account) {
  return /^\d{6,12}$/.test(account);
}

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, name: user.name, v: user.token_version || 0 },
    jwtSecret,
    { expiresIn: jwtExpiresIn }
  );
}

function cleanText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function storeEmailCode(email, purpose, code) {
  const codeHash = await bcrypt.hash(code, 10);
  const [result] = await pool.query(
    `INSERT INTO email_verification_codes (email, purpose, code_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
    [email, purpose, codeHash]
  );
  return result.insertId;
}

async function consumeEmailCode(conn, email, purpose, code) {
  const [rows] = await conn.query(
    `SELECT id, code_hash
     FROM email_verification_codes
     WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1
     FOR UPDATE`,
    [email, purpose]
  );
  const row = rows[0];
  if (!row || !(await bcrypt.compare(String(code || ''), row.code_hash))) {
    const err = new Error('邮箱验证码错误或已过期');
    err.statusCode = 400;
    throw err;
  }
  await conn.query('UPDATE email_verification_codes SET consumed_at = NOW() WHERE id = ?', [row.id]);
}

async function findCollegeId(className, major, grade, collegeId) {
  const parsedCollegeId = parseInt(collegeId, 10);
  if (parsedCollegeId) return parsedCollegeId;

  if (className) {
    const [byClassOption] = await pool.query(
      'SELECT college_id FROM class_options WHERE class_name = ? AND major = ? AND grade = ? AND college_id IS NOT NULL AND is_active = TRUE ORDER BY id LIMIT 1',
      [className, major, normalizeGrade(grade)]
    );
    if (byClassOption[0]) return byClassOption[0].college_id;

    const [byClass] = await pool.query(
      'SELECT college_id FROM students WHERE class_name = ? AND college_id IS NOT NULL ORDER BY id LIMIT 1',
      [className]
    );
    if (byClass[0]) return byClass[0].college_id;
  }

  if (major) {
    const [byMajor] = await pool.query(
      'SELECT college_id FROM students WHERE major = ? AND college_id IS NOT NULL ORDER BY id LIMIT 1',
      [major]
    );
    if (byMajor[0]) return byMajor[0].college_id;
  }

  const [cols] = await pool.query('SELECT id FROM colleges ORDER BY id LIMIT 1');
  return cols[0] ? cols[0].id : null;
}

async function mapLoginUser(user) {
  if (user.role === 'student') {
    const student = await Student.findByUserId(user.id);
    if (!student) {
      const err = new Error('学生信息不存在，请先完成注册或联系管理员导入');
      err.statusCode = 403;
      throw err;
    }
    return {
      id: user.id,
      account: user.account,
      name: user.name,
      role: user.role,
      email: user.email || null,
      isAssistant: student.is_assistant ? true : false,
      studentInfo: student
    };
  }

  if (user.role === 'counselor') {
    const teacher = await Teacher.findByUserId(user.id);
    return { id: user.id, account: user.account, name: user.name, role: user.role, email: user.email || null, teacherInfo: teacher };
  }

  return { id: user.id, account: user.account, name: user.name, role: user.role, email: user.email || null };
}

// ==================== 统一登录（本地账号） ====================
exports.login = async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const account = cleanText(req.body.account, 50);
    const password = String(req.body.password || '');
    if (!account || !password) return res.status(400).json({ error: '请输入账号和密码' });

    const user = await User.findByAccount(account);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: isStudentId(account) ? '学号或密码错误，请先注册或联系管理员' : '账号或密码错误' });
    }

    await conn.beginTransaction();
    await conn.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [user.id]);
    await conn.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [user.id]);
    const [updatedRows] = await conn.query(
      'SELECT id, account, role, name, email, token_version FROM users WHERE id = ?',
      [user.id]
    );
    await conn.commit();

    const activeUser = updatedRows[0];
    const token = signToken(activeUser);
    const mappedUser = await mapLoginUser(activeUser);
    res.json({ token, user: mappedUser });
  } catch (err) {
    if (conn) await conn.rollback().catch(() => {});
    console.error('登录错误:', err);
    res.status(err.statusCode || 500).json({ error: err.statusCode ? err.message : '服务器内部错误' });
  } finally {
    if (conn) conn.release();
  }
};

exports.sendEmailCode = async (req, res) => {
  try {
    const email = cleanText(req.body.email, 120);
    const purpose = cleanText(req.body.purpose, 20);
    const account = cleanText(req.body.account, 50);
    if (!isValidEmail(email)) return res.status(400).json({ error: '请输入正确的邮箱号' });
    if (!['register', 'reset_password'].includes(purpose)) return res.status(400).json({ error: '验证码用途不正确' });

    if (purpose === 'register') {
      const [used] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
      if (used.length > 0) return res.status(400).json({ error: '该邮箱已被注册' });
    } else {
      if (!account) return res.status(400).json({ error: '请输入账号' });
      const [users] = await pool.query('SELECT id FROM users WHERE account = ? AND email = ? LIMIT 1', [account, email]);
      if (users.length === 0) return res.status(400).json({ error: '账号与邮箱不匹配' });
    }

    const [recent] = await pool.query(
      `SELECT created_at FROM email_verification_codes
       WHERE email = ? AND purpose = ? AND created_at > DATE_SUB(NOW(), INTERVAL 60 SECOND)
       ORDER BY created_at DESC LIMIT 1`,
      [email, purpose]
    );
    if (recent.length > 0) return res.status(429).json({ error: '验证码发送过于频繁，请稍后再试' });

    const code = makeCode();
    const codeId = await storeEmailCode(email, purpose, code);
    try {
      await sendVerificationCode(email, code, purpose);
    } catch (sendError) {
      await pool.query('DELETE FROM email_verification_codes WHERE id = ?', [codeId]);
      throw sendError;
    }
    res.json({ message: '验证码已发送' });
  } catch (err) {
    console.error('发送验证码失败:', err);
    res.status(err.statusCode || 500).json({ error: err.message || '验证码发送失败' });
  }
};

// ==================== 辅导员注册（本地账号） ====================
exports.registerCounselor = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const account = cleanText(req.body.account || req.body.employeeId, 50);
    const name = cleanText(req.body.name, 50);
    const password = String(req.body.password || '');
    const email = cleanText(req.body.email, 120);
    const emailCode = cleanText(req.body.emailCode || req.body.code, 10);
    const legacyMajor = cleanText(req.body.major, 100);
    const legacyClassName = standardizeClassNameForDisplay(cleanText(req.body.className || req.body.class_name, 100));
    const requestedGrade = normalizeGrade(cleanText(req.body.grade, 20));
    const requestedCollegeId = parseInt(req.body.collegeId || req.body.college_id, 10) || null;
    const submittedClasses = Array.isArray(req.body.classes) ? req.body.classes : [];
    let classTargets = submittedClasses
      .map(item => ({
        grade: normalizeGrade(cleanText(item?.grade || requestedGrade, 20)),
        major: cleanText(item?.major, 100),
        className: standardizeClassNameForDisplay(cleanText(item?.className || item?.class_name, 100)),
        collegeId: parseInt(item?.collegeId || item?.college_id, 10) || requestedCollegeId || null
      }))
      .filter(item => item.major && item.className);

    if (classTargets.length === 0 && legacyMajor && legacyClassName) {
      classTargets = [{
        grade: requestedGrade,
        major: legacyMajor,
        className: legacyClassName,
        collegeId: requestedCollegeId
      }];
    }

    const grade = requestedGrade || classTargets[0]?.grade || '';
    classTargets = Array.from(new Map(classTargets
      .map(item => ({ ...item, grade: normalizeGrade(item.grade || grade) }))
      .filter(item => item.grade && item.major && item.className)
      .map(item => [`${item.grade}|${item.major}|${item.className}|${item.collegeId || ''}`, item])
    ).values());

    if (!account || account.toLowerCase() === 'admin') return res.status(400).json({ error: '请输入有效的辅导员工号' });
    if (!name) return res.status(400).json({ error: '请输入姓名' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少需要 6 位' });
    if (!isValidEmail(email)) return res.status(400).json({ error: '请输入正确的邮箱号' });
    if (!emailCode) return res.status(400).json({ error: '请输入邮箱验证码' });
    if (!grade || classTargets.length === 0) return res.status(400).json({ error: '请选择年级和至少一个负责班级' });
    if (classTargets.some(item => item.grade !== grade)) return res.status(400).json({ error: '辅导员注册只能选择同一管理年级下的班级' });

    const resolvedClasses = [];
    for (const target of classTargets) {
      const [options] = await conn.query(
        `SELECT id, college_id FROM class_options
         WHERE grade = ? AND major = ? AND class_name = ? AND is_active = TRUE
           AND (? IS NULL OR college_id <=> ?)
         ORDER BY id LIMIT 1`,
        [target.grade, target.major, target.className, target.collegeId, target.collegeId]
      );
      if (!options[0]) return res.status(400).json({ error: `专业班级选项不存在：${target.grade} / ${target.major} / ${target.className}` });
      resolvedClasses.push({
        ...target,
        collegeId: options[0].college_id || target.collegeId || null
      });
    }

    const collegeIds = Array.from(new Set(resolvedClasses.map(item => item.collegeId).filter(Boolean)));
    if (collegeIds.length > 1) return res.status(400).json({ error: '辅导员注册暂不支持一次选择多个学院的班级' });
    const collegeId = collegeIds[0] || requestedCollegeId || await findCollegeId(resolvedClasses[0].className, resolvedClasses[0].major, grade, null);
    if (!collegeId) return res.status(400).json({ error: '未找到所属学院，请先选择学院后重试' });

    await conn.beginTransaction();
    await consumeEmailCode(conn, email, 'register', emailCode);

    const [users] = await conn.query('SELECT * FROM users WHERE account = ? FOR UPDATE', [account]);
    const existingUser = users[0] || null;
    if (existingUser && existingUser.role !== 'counselor') {
      await conn.rollback();
      return res.status(400).json({ error: '该工号已被其他角色账号占用' });
    }
    if (existingUser && existingUser.email) {
      await conn.rollback();
      return res.status(400).json({ error: '该工号已注册，请直接登录或使用邮箱找回密码' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let userId;
    if (existingUser) {
      await conn.query(
        `UPDATE users SET password_hash = ?, name = ?, email = ?, role = 'counselor', token_version = token_version + 1
         WHERE id = ?`,
        [passwordHash, name, email, existingUser.id]
      );
      userId = existingUser.id;
    } else {
      const [created] = await conn.query(
        `INSERT INTO users (account, password_hash, role, name, email)
         VALUES (?, ?, 'counselor', ?, ?)`,
        [account, passwordHash, name, email]
      );
      userId = created.insertId;
    }

    const [teachers] = await conn.query('SELECT * FROM teachers WHERE employee_id = ? FOR UPDATE', [account]);
    const existingTeacher = teachers[0] || null;
    let teacherId;
    if (existingTeacher) {
      if (existingTeacher.user_id && Number(existingTeacher.user_id) !== Number(userId)) {
        await conn.rollback();
        return res.status(400).json({ error: '该工号已绑定其他账号，请联系管理员处理' });
      }
      await conn.query(
        `UPDATE teachers SET user_id = ?, name = ?, grade = ?, college_id = ? WHERE id = ?`,
        [userId, name, grade, collegeId, existingTeacher.id]
      );
      teacherId = existingTeacher.id;
    } else {
      const [created] = await conn.query(
        `INSERT INTO teachers (user_id, employee_id, name, grade, college_id)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, account, name, grade, collegeId]
      );
      teacherId = created.insertId;
    }

    for (const target of resolvedClasses) {
      const [occupied] = await conn.query(
        `SELECT t.name FROM teacher_classes tc
         JOIN teachers t ON t.id = tc.teacher_id
         WHERE tc.class_name = ? AND t.grade = ? AND t.id <> ?
         LIMIT 1`,
        [target.className, grade, teacherId]
      );
      if (occupied[0]) {
        await conn.rollback();
        return res.status(400).json({ error: `班级“${target.className}”已由辅导员“${occupied[0].name}”负责，请取消选择或联系管理员调整` });
      }
    }

    await conn.query('DELETE FROM teacher_classes WHERE teacher_id = ?', [teacherId]);
    for (const target of resolvedClasses) {
      await conn.query(
        'INSERT IGNORE INTO teacher_classes (teacher_id, class_name) VALUES (?, ?)',
        [teacherId, target.className]
      );
      await conn.query(
        'UPDATE students SET counselor_name = ? WHERE class_name = ? AND grade = ?',
        [name, target.className, grade]
      );
    }
    await conn.commit();

    const user = await User.findByAccount(account);
    const token = signToken(user);
    const mappedUser = await mapLoginUser(user);
    res.status(201).json({ token, user: mappedUser, message: '辅导员注册成功' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '该工号或邮箱已存在' });
    console.error('辅导员注册错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
  } finally {
    conn.release();
  }
};

// ==================== 学生注册（本地账号） ====================
exports.registerStudent = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const account = cleanText(req.body.account || req.body.studentId, 20);
    const name = cleanText(req.body.name, 50);
    const password = String(req.body.password || '');
    const email = cleanText(req.body.email, 120);
    const emailCode = cleanText(req.body.emailCode || req.body.code, 10);
    const major = cleanText(req.body.major, 100);
    const rawClassName = cleanText(req.body.className || req.body.class_name, 100);
    const className = standardizeClassNameForDisplay(rawClassName);
    const gradeInput = cleanText(req.body.grade, 20);
    const gender = cleanText(req.body.gender, 10) || null;
    const counselorName = cleanText(req.body.counselorName || req.body.counselor_name, 50);

    if (!isStudentId(account)) return res.status(400).json({ error: '请输入正确的学号' });
    if (!name) return res.status(400).json({ error: '请输入姓名' });
    if (password.length < 6) return res.status(400).json({ error: '密码至少需要 6 位' });
    if (!major) return res.status(400).json({ error: '请选择专业' });
    if (!className) return res.status(400).json({ error: '请选择班级' });
    if (!counselorName) return res.status(400).json({ error: '请输入辅导员姓名' });
    if (!isValidEmail(email)) return res.status(400).json({ error: '请输入正确的邮箱号' });
    if (!emailCode) return res.status(400).json({ error: '请输入邮箱验证码' });

    const passwordHash = await bcrypt.hash(password, 10);
    const grade = gradeInput || inferGradeFromStudentId(account) || inferGradeFromClassName(rawClassName);
    if (!normalizeGrade(grade)) return res.status(400).json({ error: '请选择或填写正确的年级' });
    const collegeId = await findCollegeId(className, major, grade, req.body.collegeId || req.body.college_id);

    const [classOptions] = await conn.query(
      `SELECT id, college_id FROM class_options
       WHERE grade = ? AND major = ? AND class_name = ? AND is_active = TRUE
       ORDER BY id LIMIT 1`,
      [normalizeGrade(grade), major, className]
    );
    if (!classOptions[0]) {
      return res.status(400).json({ error: '该年级、专业和班级未开放注册，请联系管理员在班级管理中配置' });
    }

    const [assignedCounselors] = await conn.query(
      `SELECT t.name, t.grade, tc.class_name
       FROM teacher_classes tc
       JOIN teachers t ON t.id = tc.teacher_id`
    );
    const eligibleCounselors = assignedCounselors.filter(item =>
      normalizeClassName(item.class_name) === normalizeClassName(className) &&
      normalizeGrade(item.grade) === normalizeGrade(grade)
    );
    if (eligibleCounselors.length === 0) {
      return res.status(400).json({ error: '该专业班级尚未配置对应年级辅导员，请联系管理员' });
    }
    if (!eligibleCounselors.some(item => item.name === counselorName)) {
      return res.status(400).json({ error: '所选辅导员与该专业班级或年级不匹配，请重新选择' });
    }

    await conn.beginTransaction();
    await consumeEmailCode(conn, email, 'register', emailCode);

    const [users] = await conn.query('SELECT * FROM users WHERE account = ? FOR UPDATE', [account]);
    const existingUser = users[0] || null;
    if (existingUser && existingUser.role !== 'student') {
      await conn.rollback();
      return res.status(400).json({ error: '该账号已被非学生用户占用' });
    }

    const [students] = await conn.query('SELECT * FROM students WHERE student_id = ? FOR UPDATE', [account]);
    const existingStudent = students[0] || null;
    if (existingStudent && existingStudent.name && existingStudent.name !== name) {
      await conn.rollback();
      return res.status(400).json({ error: '姓名与已导入学生信息不一致，请联系管理员核对' });
    }

    if (existingUser && existingUser.email) {
      await conn.rollback();
      return res.status(400).json({ error: '该学号已注册，请直接登录' });
    }

    let userId = existingUser ? existingUser.id : null;
    if (userId) {
      await conn.query(
        "UPDATE users SET password_hash = ?, name = ?, email = ?, role = 'student', token_version = token_version + 1 WHERE id = ?",
        [passwordHash, name, email, userId]
      );
    } else {
      const [created] = await conn.query(
        "INSERT INTO users (account, password_hash, role, name, email) VALUES (?, ?, 'student', ?, ?)",
        [account, passwordHash, name, email]
      );
      userId = created.insertId;
    }

    if (existingStudent) {
      await conn.query(
        `UPDATE students
         SET user_id = ?, name = ?, grade = COALESCE(NULLIF(?, ''), grade), major = ?, class_name = ?, college_id = ?, gender = ?, counselor_name = ?
         WHERE id = ?`,
        [userId, name, grade, major, className, collegeId, gender, counselorName, existingStudent.id]
      );
    } else {
      await conn.query(
        `INSERT INTO students (user_id, student_id, name, grade, major, class_name, college_id, gender, counselor_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, account, name, grade, major, className, collegeId, gender, counselorName]
      );
    }

    await conn.query(
      `INSERT IGNORE INTO class_options (college_id, grade, major, class_name)
       VALUES (?, ?, ?, ?)`,
      [collegeId, normalizeGrade(grade), major, className]
    );

    await conn.commit();

    const user = await User.findByAccount(account);
    const token = signToken(user);
    const mappedUser = await mapLoginUser(user);
    res.status(201).json({ token, user: mappedUser, message: '注册成功' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '该学号或邮箱已存在' });
    console.error('注册错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
  } finally {
    conn.release();
  }
};

exports.register = async (req, res) => {
  if (String(req.body.role || '').toLowerCase() === 'counselor') {
    return exports.registerCounselor(req, res);
  }
  return exports.registerStudent(req, res);
};

exports.resetPassword = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const account = cleanText(req.body.account, 50);
    const email = cleanText(req.body.email, 120);
    const code = cleanText(req.body.code || req.body.emailCode, 10);
    const newPassword = String(req.body.newPassword || req.body.password || '');
    if (!account) return res.status(400).json({ error: '请输入账号' });
    if (!isValidEmail(email)) return res.status(400).json({ error: '请输入正确的邮箱号' });
    if (!code) return res.status(400).json({ error: '请输入邮箱验证码' });
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少需要 6 位' });

    await conn.beginTransaction();
    const [users] = await conn.query('SELECT id FROM users WHERE account = ? AND email = ? FOR UPDATE', [account, email]);
    if (users.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: '账号与邮箱不匹配' });
    }
    await consumeEmailCode(conn, email, 'reset_password', code);
    await conn.query(
      'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
      [await bcrypt.hash(newPassword, 10), users[0].id]
    );
    await conn.commit();
    res.json({ message: '密码已重置，请使用新密码登录' });
  } catch (err) {
    await conn.rollback().catch(() => {});
    res.status(err.statusCode || 500).json({ error: err.message || '密码重置失败' });
  } finally {
    conn.release();
  }
};

// ==================== 注册下拉选项 ====================
exports.getRegisterOptions = async (_req, res) => {
  try {
    const [colleges] = await pool.query('SELECT id, name, code FROM colleges ORDER BY id');
    const [majors] = await pool.query(
      `SELECT DISTINCT major FROM class_options
       WHERE is_active = TRUE AND grade <> '未设置'
       ORDER BY major`
    );
    const [classes] = await pool.query(
      `SELECT DISTINCT class_name, major, grade, college_id
       FROM class_options
       WHERE is_active = TRUE AND grade <> '未设置'
       ORDER BY grade, major, class_name`
    );
    const [teachers] = await pool.query(
      `SELECT t.id, t.name, t.grade, tc.class_name
       FROM teachers t
       LEFT JOIN teacher_classes tc ON tc.teacher_id = t.id
       WHERE t.name <> ''
       ORDER BY t.grade, t.name, tc.class_name`
    );

    res.json({
      colleges,
      majors: majors.map(item => item.major),
      classes: classes.map(item => ({
        className: standardizeClassNameForDisplay(item.class_name),
        major: item.major || '',
        grade: normalizeGrade(item.grade),
        collegeId: item.college_id || null,
      })).map(item => ({
          ...item,
          counselors: teachers
            .filter(teacher => teacher.class_name && normalizeClassName(teacher.class_name) === normalizeClassName(item.className) && normalizeGrade(teacher.grade) === item.grade)
            .map(teacher => ({ id: teacher.id, name: teacher.name, grade: normalizeGrade(teacher.grade) }))
        })),
      counselors: Array.from(new Map(teachers.map(item => [item.id, {
        id: item.id,
        name: item.name,
        grade: normalizeGrade(item.grade),
      }])).values())
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==================== me / changePassword ====================
exports.getMe = async (req, res) => {
  try {
    const u = await User.getFullInfo(req.user.userId, req.user.role);
    res.json({ user: u || {} });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.logout = async (req, res) => {
  try {
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [req.user.userId]);
    res.json({ message: '已退出登录' });
  } catch (e) {
    res.status(500).json({ error: e.message || '退出登录失败' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: '请提供旧密码和新密码' });
    const full = await User.findByAccount((await User.findById(req.user.userId)).account);
    if (!(await bcrypt.compare(oldPassword, full.password_hash))) return res.status(401).json({ error: '旧密码不正确' });
    await User.updatePassword(req.user.userId, await bcrypt.hash(newPassword, 10));
    res.json({ message: '密码修改成功' });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
