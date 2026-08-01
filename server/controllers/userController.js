const bcrypt = require('bcryptjs');
const User = require('../models/user');
const Student = require('../models/student');
const Teacher = require('../models/teacher');
const Score = require('../models/score');
const pool = require('../config/database');
const { getCurrentYearId } = require('../utils/year');
const auditLog = require('../utils/audit');
const {
  inferGradeFromClassName,
  inferGradeFromStudentId,
  normalizeClassName,
  normalizeGrade,
  resolveManagedClassScope,
  standardizeClassNameForDisplay
} = require('../utils/className');
const { assignPendingForClass, releaseAssistantAssignments } = require('../utils/reviewAssignment');

// ==================== 管理员功能 ====================

async function syncClassOption({ collegeId, grade, major, className }) {
  const cleanGrade = normalizeGrade(grade);
  const cleanMajor = String(major || '').trim();
  const cleanClassName = standardizeClassNameForDisplay(className);
  if (!cleanGrade || !cleanMajor || !cleanClassName) return;
  await pool.query(
    `INSERT INTO class_options (college_id, grade, major, class_name, is_active)
     VALUES (?, ?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE
       college_id = COALESCE(VALUES(college_id), college_id),
       is_active = TRUE`,
    [collegeId || null, cleanGrade, cleanMajor, cleanClassName]
  );
}

async function assertCounselorStudentScope(req, student) {
  if (req.user.role !== 'counselor') return;
  const teacher = await Teacher.findByUserId(req.user.userId);
  const scope = await resolveManagedClassScope(pool, teacher);
  const inClass = scope.classNames.some(name => normalizeClassName(name) === normalizeClassName(student.class_name));
  const inGrade = !scope.grade || normalizeGrade(scope.grade) === normalizeGrade(student.grade);
  if (!inClass || !inGrade) {
    const error = new Error('只能管理本人负责年级和班级内的学生');
    error.statusCode = 403;
    throw error;
  }
}

function inferMajorFromClassName(className) {
  return String(className || '').trim().replace(/[0-9０-９一二三四五六七八九十]+班$/, '').trim();
}

function cleanEmail(value) {
  return String(value || '').trim().slice(0, 120);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

async function inferCounselorNameForClass(className) {
  const classKey = normalizeClassName(className);
  if (!classKey) return '';
  const [rows] = await pool.query(
    `SELECT t.name, tc.class_name
     FROM teacher_classes tc
     JOIN teachers t ON t.id = tc.teacher_id
     ORDER BY t.id`
  );
  const found = rows.find(row => normalizeClassName(row.class_name) === classKey);
  return found ? found.name : '';
}

async function assignCounselorToClass({ className, grade, teacherId }) {
  const cleanClassName = standardizeClassNameForDisplay(className);
  const parsedTeacherId = parseInt(teacherId, 10);
  if (!cleanClassName || !parsedTeacherId) {
    const error = new Error('请选择需要绑定的辅导员');
    error.statusCode = 400;
    throw error;
  }

  const [teacherRows] = await pool.query(
    'SELECT id, name, grade FROM teachers WHERE id = ?',
    [parsedTeacherId]
  );
  const teacher = teacherRows[0];
  if (!teacher) {
    const error = new Error('辅导员不存在');
    error.statusCode = 404;
    throw error;
  }

  const teacherGrade = normalizeGrade(teacher.grade);
  if (!teacherGrade) {
    const error = new Error('请先为该辅导员设置管理年级');
    error.statusCode = 400;
    throw error;
  }
  const targetGrade = normalizeGrade(grade) || teacherGrade;
  if (targetGrade !== teacherGrade) {
    const error = new Error('所选辅导员的管理年级与该专业班级不一致');
    error.statusCode = 400;
    throw error;
  }

  const classKey = normalizeClassName(cleanClassName);
  const [assignedRows] = await pool.query(
    `SELECT tc.id, tc.teacher_id, tc.class_name, t.grade
     FROM teacher_classes tc
     JOIN teachers t ON t.id = tc.teacher_id`
  );
  const duplicateIds = assignedRows
    .filter(row =>
      Number(row.teacher_id) !== parsedTeacherId &&
      normalizeClassName(row.class_name) === classKey &&
      normalizeGrade(row.grade) === targetGrade
    )
    .map(row => row.id);

  if (duplicateIds.length > 0) {
    await pool.query(
      `DELETE FROM teacher_classes WHERE id IN (${duplicateIds.map(() => '?').join(',')})`,
      duplicateIds
    );
  }
  await pool.query(
    'INSERT IGNORE INTO teacher_classes (teacher_id, class_name) VALUES (?, ?)',
    [parsedTeacherId, cleanClassName]
  );

  const [studentRows] = await pool.query(
    'SELECT id, student_id, class_name, grade FROM students WHERE class_name IS NOT NULL AND class_name <> ""'
  );
  const studentIds = studentRows
    .filter(row =>
      normalizeClassName(row.class_name) === classKey &&
      normalizeGrade(row.grade || inferGradeFromStudentId(row.student_id)) === targetGrade
    )
    .map(row => row.id);
  if (studentIds.length > 0) {
    await pool.query(
      `UPDATE students SET counselor_name = ? WHERE id IN (${studentIds.map(() => '?').join(',')})`,
      [teacher.name, ...studentIds]
    );
  }

  return {
    id: teacher.id,
    name: teacher.name,
    grade: targetGrade,
    className: cleanClassName,
    updatedStudents: studentIds.length,
  };
}

async function resolveTeacherIdByIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return null;
  const numericId = Number(value);
  const clauses = [];
  const params = [];
  if (Number.isFinite(numericId) && numericId > 0) {
    clauses.push('id = ?');
    params.push(numericId);
  }
  clauses.push('employee_id = ?');
  params.push(value);
  clauses.push('name = ?');
  params.push(value);

  const [rows] = await pool.query(
    `SELECT id FROM teachers WHERE ${clauses.join(' OR ')} ORDER BY id LIMIT 2`,
    params
  );
  return rows.length === 1 ? rows[0].id : null;
}

exports.getDashboard = async (req, res) => {
  try {
    const yearId = await getCurrentYearId(req.query.yearId);
    const stats = await Score.getDashboardStats(yearId);

    const [classes] = await pool.query(
      'SELECT class_name, COUNT(*) as count FROM students GROUP BY class_name ORDER BY class_name'
    );
    const [modules] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    const [recentSubs] = await pool.query(
      `SELECT sub.*, s.name as student_name, si.name as item_name
       FROM submissions sub JOIN students s ON sub.student_id = s.id
       JOIN scoring_items si ON sub.item_id = si.id
       ORDER BY sub.submit_at DESC LIMIT 5`
    );

    const classMap = new Map();
    for (const row of classes) {
      const className = standardizeClassNameForDisplay(row.class_name);
      classMap.set(className, (classMap.get(className) || 0) + Number(row.count || 0));
    }
    const normalizedClasses = Array.from(classMap.entries()).map(([class_name, count]) => ({ class_name, count }));

    res.json({ stats, classes: normalizedClasses, modules, recentSubmissions: recentSubs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

// ==================== 学年管理 ====================
exports.getYears = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM academic_years ORDER BY name');
    res.json({ years: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createYear = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '请输入学年名称' });
    const [result] = await pool.query('INSERT INTO academic_years (name) VALUES (?)', [name]);
    await auditLog(req, 'year.create', 'academic_year', result.insertId, { name });
    res.status(201).json({ year: { id: result.insertId, name } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '该学年已存在' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.deleteYear = async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM academic_years WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: '学年不存在' });
    await auditLog(req, 'year.delete', 'academic_year', req.params.id, null);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==================== 教师管理 ====================
exports.getTeachers = async (req, res) => {
  try {
    if (req.user && req.user.role === 'counselor') {
      const teacher = await Teacher.findByUserId(req.user.userId);
      return res.json({ teachers: teacher ? [teacher] : [] });
    }
    const teachers = await Teacher.findAll();
    res.json({ teachers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createTeacher = async (req, res) => {
  try {
    const { employeeId, name, collegeId, grade, classes, password } = req.body;
    const email = cleanEmail(req.body.email);
    if (!employeeId || !name) return res.status(400).json({ error: '工号和姓名必填' });
    if (email && !isValidEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });

    const initialPassword = String(password || process.env.INIT_DEFAULT_PASSWORD || Math.random().toString(36).slice(2, 10));
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    const user = await User.create({ account: employeeId, passwordHash, role: 'counselor', name, email: email || null });

    const teacher = await Teacher.create({
      employeeId, name, collegeId: collegeId || 1, grade: grade || '', userId: user.id,
    });

    if (classes && classes.length > 0) {
      await Teacher.setClasses(teacher.id, classes);
    }

    teacher.classes = classes || [];
    await auditLog(req, 'teacher.create', 'teacher', teacher.id, { employeeId, email: email || null, classes: teacher.classes });
    res.status(201).json({ teacher, initialPassword });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const message = String(err.sqlMessage || err.message || '');
      return res.status(400).json({ error: message.includes('email') ? '该邮箱已被其他账号使用' : '该工号已存在' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.updateTeacher = async (req, res) => {
  try {
    const teacherId = req.params.id;
    const employeeId = String(req.body.employeeId || req.body.teacherId || '').trim();
    const name = String(req.body.name || '').trim();
    const grade = String(req.body.grade || '').trim();
    const collegeId = parseInt(req.body.collegeId || req.body.college_id) || 1;
    const password = String(req.body.password || '');
    const hasEmailField = Object.prototype.hasOwnProperty.call(req.body, 'email');
    const email = cleanEmail(req.body.email);

    if (!employeeId || !name) return res.status(400).json({ error: '工号和姓名必填' });
    if (hasEmailField && email && !isValidEmail(email)) return res.status(400).json({ error: '邮箱格式不正确' });

    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return res.status(404).json({ error: '教师不存在' });

    const [dup] = await pool.query(
      'SELECT id FROM teachers WHERE employee_id = ? AND id <> ?',
      [employeeId, teacherId]
    );
    if (dup.length > 0) return res.status(400).json({ error: '该工号已被其他教师使用' });

    let userId = teacher.user_id || null;
    if (!userId) {
      const [users] = await pool.query('SELECT id FROM users WHERE account = ?', [employeeId]);
      userId = users[0] ? users[0].id : null;
      if (!userId) {
        const defaultPwd = process.env.INIT_DEFAULT_PASSWORD || Math.random().toString(36).slice(2, 10);
        const passwordHash = await bcrypt.hash(defaultPwd, 10);
        const user = await User.create({ account: employeeId, passwordHash, role: 'counselor', name, email: email || null });
        userId = user.id;
      }
    }

    await pool.query(
      'UPDATE teachers SET employee_id = ?, name = ?, college_id = ?, grade = ?, user_id = ? WHERE id = ?',
      [employeeId, name, collegeId, grade, userId, teacherId]
    );
    if (hasEmailField) {
      await pool.query(
        "UPDATE users SET account = ?, name = ?, email = ?, role = 'counselor', token_version = token_version + 1 WHERE id = ?",
        [employeeId, name, email || null, userId]
      );
    } else {
      await pool.query(
        "UPDATE users SET account = ?, name = ?, role = 'counselor', token_version = token_version + 1 WHERE id = ?",
        [employeeId, name, userId]
      );
    }
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: '密码至少需要 6 位' });
      await User.updatePassword(userId, await bcrypt.hash(password, 10));
    }

    await auditLog(req, 'teacher.update', 'teacher', teacherId, { employeeId, name, email: hasEmailField ? email || null : undefined, collegeId, grade, passwordChanged: Boolean(password) });
    res.json({ message: '教师信息已更新' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const message = String(err.sqlMessage || err.message || '');
      return res.status(400).json({ error: message.includes('email') ? '该邮箱已被其他账号使用' : '该工号已存在' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.deleteTeacher = async (req, res) => {
  try {
    const teacher = await Teacher.findById(req.params.id);
    if (!teacher) return res.status(404).json({ error: '教师不存在' });
    await Teacher.delete(req.params.id);
    if (teacher.user_id) await pool.query('DELETE FROM users WHERE id = ?', [teacher.user_id]);
    await auditLog(req, 'teacher.delete', 'teacher', req.params.id, { employeeId: teacher.employee_id });
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.importTeachers = async (req, res) => {
  try {
    const { teachers } = req.body;
    if (!Array.isArray(teachers) || teachers.length === 0) return res.status(400).json({ error: '无数据' });
    if (teachers.length > 5000) return res.status(400).json({ error: '单次最多导入 5000 条教师数据' });

    const batchPwd = process.env.INIT_DEFAULT_PASSWORD || Math.random().toString(36).slice(2, 10);
    const results = [];
    const failed = [];
    for (let index = 0; index < teachers.length; index += 1) {
      const t = teachers[index] || {};
      const employeeId = String(t.employeeId || t.teacherId || '').trim();
      const name = String(t.name || '').trim();
      const email = cleanEmail(t.email);
      try {
        if (!employeeId || !name) throw new Error('工号和姓名必填');
        if (email && !isValidEmail(email)) throw new Error('邮箱格式不正确');
        if (email) {
          const [emailUsers] = await pool.query('SELECT id FROM users WHERE email = ? AND account <> ? LIMIT 1', [email, employeeId]);
          if (emailUsers.length > 0) throw new Error('邮箱已被其他账号使用');
        }
        const explicitPassword = String(t.password || '');
        if (explicitPassword && explicitPassword.length < 6) throw new Error('密码至少需要 6 位');
        const [users] = await pool.query('SELECT id, role FROM users WHERE account = ?', [employeeId]);
        if (users[0] && users[0].role !== 'counselor') throw new Error('该工号已被其他角色账号使用');
        let userId;
        if (users[0]) {
          userId = users[0].id;
          const userUpdates = ['name = ?'];
          const userParams = [name];
          if (email) {
            userUpdates.push('email = ?');
            userParams.push(email);
          }
          if (explicitPassword) {
            userUpdates.push('password_hash = ?', 'token_version = token_version + 1');
            userParams.push(await bcrypt.hash(explicitPassword, 10));
          }
          userParams.push(userId);
          await pool.query(`UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`, userParams);
        } else {
          const rowPassword = explicitPassword || batchPwd;
          const [created] = await pool.query(
            `INSERT INTO users (account, password_hash, role, name, email) VALUES (?, ?, 'counselor', ?, ?)`,
            [employeeId, await bcrypt.hash(rowPassword, 10), name, email || null]
          );
          userId = created.insertId;
        }
        await pool.query(
          `INSERT INTO teachers (employee_id, name, college_id, grade, user_id)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), college_id = VALUES(college_id), grade = VALUES(grade), user_id = VALUES(user_id)`,
          [employeeId, name, t.collegeId || 1, normalizeGrade(t.grade), userId]
        );
        const [teacherRows] = await pool.query('SELECT * FROM teachers WHERE employee_id = ?', [employeeId]);
        const teacher = teacherRows[0];
        if (Array.isArray(t.classes) && t.classes.length > 0) {
          await Teacher.setClasses(teacher.id, t.classes);
        }
        results.push(teacher);
      } catch (err) {
        failed.push({ row: index + 2, employeeId, error: err.message });
      }
    }
    await auditLog(req, 'teacher.import', 'teacher', null, { count: results.length, failed: failed.length });
    res.status(201).json({ count: results.length, failedCount: failed.length, failed: failed.slice(0, 50), teachers: results, initialPassword: batchPwd });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==================== 学生管理 ====================
exports.getStudents = async (req, res) => {
  try {
    const filters = {};
    if (req.query.collegeId) filters.collegeId = parseInt(req.query.collegeId);
    if (req.query.major) filters.major = req.query.major;
    if (req.query.className) filters.className = req.query.className;
    if (req.query.grade) filters.grade = req.query.grade;
    if (req.query.keyword) filters.keyword = req.query.keyword;
    if (req.query.matchMode === 'exact') filters.matchMode = 'exact';
    let students = await Student.findAll(filters);
    if (req.user && req.user.role === 'counselor') {
      const teacher = await Teacher.findByUserId(req.user.userId);
      const scope = await resolveManagedClassScope(pool, teacher);
      const allowedClasses = scope.classNames;
      const allowedKeys = new Set(allowedClasses.map(normalizeClassName));
      students = students.filter(student =>
        allowedKeys.has(normalizeClassName(student.class_name)) &&
        (!scope.grade || normalizeGrade(student.grade) === normalizeGrade(scope.grade))
      );
    }
    res.json({ students });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 学院/专业/班级统计数据
exports.getStudentStats = async (req, res) => {
  try {
    let stats;
    if (req.user && req.user.role === 'counselor') {
      const teacher = await Teacher.findByUserId(req.user.userId);
      const scope = await resolveManagedClassScope(pool, teacher);
      const allowed = new Set(scope.classNames.map(normalizeClassName));
      const students = (await Student.findAll()).filter(student =>
        allowed.has(normalizeClassName(student.class_name)) &&
        (!scope.grade || normalizeGrade(student.grade) === normalizeGrade(scope.grade))
      );
      const group = (keyFn, mapFn) => Array.from(students.reduce((map, student) => {
        const key = keyFn(student);
        if (!map.has(key)) map.set(key, { ...mapFn(student), total: 0 });
        map.get(key).total += 1;
        return map;
      }, new Map()).values()).sort((a, b) => b.total - a.total);
      stats = {
        byCollege: group(s => String(s.college_id), s => ({ college_id: s.college_id, college_name: s.college_name })),
        byMajor: group(s => `${s.college_id}|${s.major}`, s => ({ college_id: s.college_id, college_name: s.college_name, major: s.major })),
        byClass: group(s => `${s.college_id}|${normalizeGrade(s.grade)}|${normalizeClassName(s.class_name)}`, s => ({
          college_id: s.college_id,
          college_name: s.college_name,
          major: s.major,
          class_name: s.class_name,
          grade: s.grade,
        })),
      };
    } else {
      stats = await Student.getStats();
    }
    const [colleges] = await pool.query('SELECT id, name, code FROM colleges ORDER BY id');
    res.json({ stats, colleges });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getClassOptions = async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT co.*, c.name AS college_name
       FROM class_options co
       LEFT JOIN colleges c ON c.id = co.college_id
       WHERE co.is_active = TRUE
       ORDER BY c.id, co.grade, co.major, co.class_name`
    );
    const [counselorRows] = await pool.query(
      `SELECT t.id, t.name, t.grade, tc.class_name
       FROM teacher_classes tc
       JOIN teachers t ON t.id = tc.teacher_id
       ORDER BY t.grade, t.name`
    );
    res.json({
      options: rows.map(row => {
        const className = standardizeClassNameForDisplay(row.class_name);
        const classKey = normalizeClassName(className);
        const grade = normalizeGrade(row.grade);
        return {
          ...row,
          class_name: className,
          counselors: counselorRows
            .filter(item => normalizeClassName(item.class_name) === classKey && normalizeGrade(item.grade) === grade)
            .map(item => ({ id: item.id, name: item.name, grade: normalizeGrade(item.grade) })),
        };
      })
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createClassOption = async (req, res) => {
  try {
    const grade = normalizeGrade(req.body.grade);
    const major = String(req.body.major || '').trim();
    const className = standardizeClassNameForDisplay(req.body.className || req.body.class_name);
    const collegeId = parseInt(req.body.collegeId || req.body.college_id, 10) || null;
    const counselorId = parseInt(req.body.counselorId || req.body.counselor_id, 10) || null;
    if (!grade || !major || !className) return res.status(400).json({ error: '年级、专业和班级必填' });
    await syncClassOption({ collegeId, grade, major, className });
    const counselor = counselorId ? await assignCounselorToClass({ className, grade, teacherId: counselorId }) : null;
    await auditLog(req, 'classOption.create', 'class_option', className, { grade, major, className, collegeId, counselorId });
    res.status(201).json({ message: counselor ? '专业班级及辅导员已保存' : '专业班级已保存', counselor });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.updateClassOption = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const grade = normalizeGrade(req.body.grade);
    const major = String(req.body.major || '').trim();
    const className = standardizeClassNameForDisplay(req.body.className || req.body.class_name);
    const collegeId = parseInt(req.body.collegeId || req.body.college_id, 10) || null;
    const counselorId = parseInt(req.body.counselorId || req.body.counselor_id, 10) || null;
    if (!grade || !major || !className) return res.status(400).json({ error: '年级、专业和班级必填' });

    await conn.beginTransaction();
    const [optionRows] = await conn.query(
      'SELECT id, grade, major, class_name, is_active FROM class_options WHERE id = ? FOR UPDATE',
      [req.params.id]
    );
    const option = optionRows[0];
    if (!option) {
      await conn.rollback();
      return res.status(404).json({ error: '专业班级选项不存在，请刷新班级列表后重试' });
    }

    const [duplicateRows] = await conn.query(
      'SELECT id, is_active FROM class_options WHERE college_id <=> ? AND grade = ? AND major = ? AND class_name = ? AND id <> ?',
      [collegeId, grade, major, className, option.id]
    );
    if (duplicateRows.length > 0) {
      const activeDuplicate = duplicateRows.find(row => Boolean(row.is_active));
      if (activeDuplicate) {
        await conn.rollback();
        return res.status(409).json({
          error: `该年级、专业、班级已由第 ${activeDuplicate.id} 条记录使用，请保留其中一条并删除重复记录`,
          duplicateId: activeDuplicate.id,
          duplicateActive: true,
        });
      }
      const inactiveDuplicateIds = duplicateRows.map(row => row.id).filter(Boolean);
      if (inactiveDuplicateIds.length > 0) {
        await conn.query(
          `DELETE FROM class_options WHERE id IN (${inactiveDuplicateIds.map(() => '?').join(',')})`,
          inactiveDuplicateIds
        );
      }
    }

    const oldClassName = option.class_name;
    const changedClassName = normalizeClassName(oldClassName) !== normalizeClassName(className);
    await conn.query(
      'UPDATE class_options SET college_id = ?, grade = ?, major = ?, class_name = ?, is_active = TRUE WHERE id = ?',
      [collegeId, grade, major, className, option.id]
    );

    // 班级名称变更属于全局资料修正，需要一并保持教师负责班级和学生资料可匹配。
    if (changedClassName) {
      await conn.query(
        `UPDATE teacher_classes tc
         JOIN teachers t ON t.id = tc.teacher_id
         SET tc.class_name = ?
         WHERE tc.class_name = ? AND t.grade = ?`,
        [className, oldClassName, option.grade]
      );
      await conn.query(
        'UPDATE students SET class_name = ?, grade = ?, major = ?, college_id = COALESCE(?, college_id) WHERE class_name = ? AND grade = ?',
        [className, grade, major, collegeId, oldClassName, option.grade]
      );
    } else {
      await conn.query(
        'UPDATE students SET grade = ?, major = ?, college_id = COALESCE(?, college_id) WHERE class_name = ? AND grade = ?',
        [grade, major, collegeId, oldClassName, option.grade]
      );
    }
    await conn.commit();

    const counselor = counselorId ? await assignCounselorToClass({ className, grade, teacherId: counselorId }) : null;
    await auditLog(req, 'classOption.update', 'class_option', option.id, {
      oldClassName,
      grade,
      major,
      className,
      collegeId,
      counselorId
    });
    res.json({ message: counselor ? '专业班级和辅导员已更新' : '专业班级已更新', counselor });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '该年级、专业、班级已存在，请保留正确记录并删除或停用重复历史记录' });
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    conn.release();
  }
};

exports.assignClassOptionCounselor = async (req, res) => {
  try {
    const [options] = await pool.query(
      'SELECT id, class_name, grade FROM class_options WHERE id = ? AND is_active = TRUE',
      [req.params.id]
    );
    if (!options[0]) return res.status(404).json({ error: '专业班级选项不存在' });
    const counselor = await assignCounselorToClass({
      className: options[0].class_name,
      grade: options[0].grade,
      teacherId: req.body.counselorId || req.body.counselor_id,
    });
    await auditLog(req, 'classOption.assignCounselor', 'class_option', req.params.id, counselor);
    res.json({ message: '辅导员已绑定', counselor });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
};

exports.importClassOptions = async (req, res) => {
  try {
    const options = Array.isArray(req.body.options) ? req.body.options : [];
    if (options.length === 0) return res.status(400).json({ error: '无数据' });
    let count = 0;
    let counselorBound = 0;
    let counselorFailed = 0;
    for (const item of options) {
      const grade = normalizeGrade(item.grade);
      const major = String(item.major || '').trim();
      const className = String(item.className || item.class_name || '').trim();
      if (!grade || !major || !className) continue;
      await syncClassOption({ collegeId: item.collegeId || item.college_id || null, grade, major, className });
      const counselorIdentifier = String(
        item.counselorEmployeeId || item.counselor_employee_id || item.counselorName || item.counselor_name || ''
      ).trim();
      if (counselorIdentifier) {
        const teacherId = await resolveTeacherIdByIdentifier(counselorIdentifier);
        if (teacherId) {
          try {
            await assignCounselorToClass({ className, grade, teacherId });
            counselorBound += 1;
          } catch (_err) {
            counselorFailed += 1;
          }
        } else {
          counselorFailed += 1;
        }
      }
      count += 1;
    }
    await auditLog(req, 'classOption.import', 'class_option', null, { count, counselorBound, counselorFailed });
    res.status(201).json({ count, counselorBound, counselorFailed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteClassOption = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, grade, major, class_name, college_id FROM class_options WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: '专业班级不存在' });
    const [result] = await pool.query('DELETE FROM class_options WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: '专业班级不存在' });
    await auditLog(req, 'classOption.delete', 'class_option', req.params.id, rows[0]);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.createStudent = async (req, res) => {
  try {
    const { studentId, name, grade, major, collegeId, gender, counselorName, password } = req.body;
    const rawClassName = req.body.className || req.body.class_name || '';
    const className = standardizeClassNameForDisplay(rawClassName);
    if (!studentId || !name) return res.status(400).json({ error: '学号和姓名必填' });

    const initialPassword = String(password || process.env.INIT_DEFAULT_PASSWORD || Math.random().toString(36).slice(2, 10));
    const passwordHash = await bcrypt.hash(initialPassword, 10);
    const user = await User.create({ account: studentId, passwordHash, role: 'student', name });

    // collegeId 优先使用前端传入的，否则取数据库中第一个学院
    var resolvedCollegeId = parseInt(collegeId) || 0;
    if (!resolvedCollegeId) {
      const [cols] = await pool.query('SELECT id FROM colleges ORDER BY id LIMIT 1');
      resolvedCollegeId = cols[0] ? cols[0].id : 1;
    }
    const resolvedGrade = grade || inferGradeFromStudentId(studentId) || inferGradeFromClassName(rawClassName);
    const resolvedMajor = major || inferMajorFromClassName(className);
    const resolvedCounselorName = counselorName || await inferCounselorNameForClass(className);
    const student = await Student.create({
      studentId, name, grade: resolvedGrade || '', major: resolvedMajor || '',
      className: className || '', collegeId: resolvedCollegeId, userId: user.id,
      gender: gender || null, counselorName: resolvedCounselorName || null,
    });
    await syncClassOption({ collegeId: resolvedCollegeId, grade: resolvedGrade, major: resolvedMajor, className });
    await auditLog(req, 'student.create', 'student', student.id, { studentId, className });
    res.status(201).json({ student, initialPassword });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '该学号已存在' });
    }
    res.status(500).json({ error: err.message });
  }
};

exports.deleteStudent = async (req, res) => {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: '学生不存在' });
    const [proofRows] = await pool.query(
      'SELECT proof_path FROM submissions WHERE student_id = ? AND proof_path IS NOT NULL AND proof_path <> \'\'',
      [student.id]
    );
    await Student.delete(req.params.id);
    if (student.user_id) await pool.query('DELETE FROM users WHERE id = ?', [student.user_id]);
    for (const proof of proofRows) {
      try {
        require('../utils/upload').deleteStoredFile(proof.proof_path);
      } catch (cleanupErr) {
        console.error('删除学生后的材料图片清理失败:', cleanupErr.message);
      }
    }
    await auditLog(req, 'student.delete', 'student', req.params.id, { studentId: student.student_id });
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.importStudents = async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) return res.status(400).json({ error: '无数据' });
    if (students.length > 5000) return res.status(400).json({ error: '单次最多导入 5000 条学生数据' });

    const batchPwd = process.env.INIT_DEFAULT_PASSWORD || Math.random().toString(36).slice(2, 10);
    const results = [];
    const failed = [];
    for (let index = 0; index < students.length; index += 1) {
      const s = students[index] || {};
      try {
        const studentId = String(s.studentId || '').trim();
        const name = String(s.name || '').trim();
        if (!studentId || !name) throw new Error('学号和姓名必填');
        const rowClassName = standardizeClassNameForDisplay(s.className);
        if (!rowClassName) throw new Error('专业班级必填');
        const explicitPassword = String(s.password || '');
        if (explicitPassword && explicitPassword.length < 6) throw new Error('密码至少需要 6 位');
        const [users] = await pool.query('SELECT id, role FROM users WHERE account = ?', [studentId]);
        if (users[0] && users[0].role !== 'student') throw new Error('该学号已被其他角色账号使用');
        let userId;
        if (users[0]) {
          userId = users[0].id;
          if (explicitPassword) {
            await pool.query(
              'UPDATE users SET name = ?, password_hash = ?, token_version = token_version + 1 WHERE id = ?',
              [name, await bcrypt.hash(explicitPassword, 10), userId]
            );
          } else {
            await pool.query('UPDATE users SET name = ? WHERE id = ?', [name, userId]);
          }
        } else {
          const rowPassword = explicitPassword || batchPwd;
          const [created] = await pool.query(
            `INSERT INTO users (account, password_hash, role, name) VALUES (?, ?, 'student', ?)`,
            [studentId, await bcrypt.hash(rowPassword, 10), name]
          );
          userId = created.insertId;
        }
        const rowMajor = s.major || inferMajorFromClassName(rowClassName);
        const resolvedCounselorName = s.counselorName || s.counselor_name || await inferCounselorNameForClass(rowClassName);
        const [result] = await pool.query(
          `INSERT INTO students (student_id, name, grade, major, class_name, college_id, user_id, gender, counselor_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), grade = VALUES(grade), major = VALUES(major), class_name = VALUES(class_name), college_id = VALUES(college_id), user_id = VALUES(user_id), gender = VALUES(gender), counselor_name = VALUES(counselor_name)`,
          [studentId, name, normalizeGrade(s.grade || inferGradeFromStudentId(studentId) || inferGradeFromClassName(s.className)), rowMajor, rowClassName, s.collegeId || 1, userId, s.gender || null, resolvedCounselorName || null]
        );
        await syncClassOption({ collegeId: s.collegeId || 1, grade: s.grade || inferGradeFromStudentId(studentId) || inferGradeFromClassName(s.className), major: rowMajor, className: rowClassName });
        results.push({ id: result.insertId, ...s });
      } catch (err) {
        failed.push({ row: index + 2, studentId: String(s.studentId || '').trim(), error: err.message });
      }
    }
    await auditLog(req, 'student.import', 'student', null, { count: results.length, failed: failed.length });
    res.status(201).json({ count: results.length, failedCount: failed.length, failed: failed.slice(0, 50), students: results, initialPassword: batchPwd });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 编辑教师负责班级
exports.updateTeacherClasses = async (req, res) => {
  try {
    const teacherId = req.params.id;
    const { classes } = req.body;
    const classNames = Array.from(new Set(
      (Array.isArray(classes) ? classes : String(classes || '').split(/[,，、\s]+/))
        .map(cls => String(cls || '').trim())
        .filter(Boolean)
    ));
    const [teacher] = await pool.query('SELECT * FROM teachers WHERE id = ?', [teacherId]);
    if (!teacher.length) return res.status(404).json({ error: '教师不存在' });
    await Teacher.setClasses(teacherId, classNames);
    await auditLog(req, 'teacher.updateClasses', 'teacher', teacherId, { classes: classNames });
    res.json({ message: '班级已更新', classes: classNames });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateTeacherGrade = async (req, res) => {
  try {
    const teacherId = req.params.id;
    const grade = String(req.body.grade || '').trim();
    if (!grade) return res.status(400).json({ error: '请填写管理年级' });
    const [teacher] = await pool.query('SELECT * FROM teachers WHERE id = ?', [teacherId]);
    if (!teacher.length) return res.status(404).json({ error: '教师不存在' });
    await pool.query('UPDATE teachers SET grade = ? WHERE id = ?', [grade, teacherId]);
    await auditLog(req, 'teacher.updateGrade', 'teacher', teacherId, { grade });
    res.json({ message: '管理年级已更新', grade });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==================== 学院列表 ====================
exports.getColleges = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM colleges ORDER BY name');
    res.json({ colleges: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ==================== 班委管理 ====================

// 列出所有班委
exports.getAssistants = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.student_id, s.name, s.class_name, s.grade, u.id as user_id
       FROM users u JOIN students s ON u.id = s.user_id
       WHERE s.is_assistant = TRUE ORDER BY s.class_name, s.student_id`
    );
    if (req.user.role !== 'counselor') return res.json({ assistants: rows });
    const teacher = await Teacher.findByUserId(req.user.userId);
    const scope = await resolveManagedClassScope(pool, teacher);
    const allowed = new Set(scope.classNames.map(normalizeClassName));
    const scopedRows = rows.filter(student =>
      allowed.has(normalizeClassName(student.class_name)) &&
      (!scope.grade || normalizeGrade(student.grade) === normalizeGrade(scope.grade))
    );
    res.json({ assistants: scopedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 将已有学生提升为班委（不改 role，只设 is_assistant 标记）
exports.promoteToAssistant = async (req, res) => {
  try {
    const { studentId, className } = req.body;
    if (!studentId) return res.status(400).json({ error: '请输入学号' });

    // 查这个学生是否在系统中
    const [students] = await pool.query('SELECT s.*, u.id as uid FROM students s LEFT JOIN users u ON s.user_id = u.id WHERE s.student_id = ?', [studentId]);
    if (students.length === 0) {
      return res.status(400).json({ error: '该学号未在系统中，请先让学生注册或由管理员导入学生信息' });
    }
    const s = students[0];
    if (!s.uid) {
      return res.status(400).json({ error: '该学生尚未绑定本地账号，请先让学生注册或由管理员导入学生信息' });
    }

    await assertCounselorStudentScope(req, s);

    // 只有管理员可以在任命班委时同时纠正班级；辅导员只能任命现有负责范围内的学生。
    let assignmentClass = s.class_name;
    if (className) {
      const cleanClassName = standardizeClassNameForDisplay(className);
      if (req.user.role === 'counselor' && normalizeClassName(cleanClassName) !== normalizeClassName(s.class_name)) {
        return res.status(403).json({ error: '辅导员不能通过班委任命修改学生班级' });
      }
      if (req.user.role === 'admin') {
        await pool.query('UPDATE students SET class_name = ? WHERE student_id = ?', [cleanClassName, studentId]);
        assignmentClass = cleanClassName;
      }
    }

    // 设置 is_assistant 标记 + 使旧 token 失效（强制重新登录）
    await pool.query("UPDATE students SET is_assistant = TRUE WHERE student_id = ?", [studentId]);
    await pool.query("UPDATE users SET token_version = token_version + 1 WHERE id = ?", [s.uid]);
    try {
      await assignPendingForClass(assignmentClass, s.grade);
    } catch (assignErr) {
      console.error('新增班委后的待审任务分配失败:', assignErr.message);
    }
    await auditLog(req, 'assistant.promote', 'user', s.uid, { studentId, className: className || s.class_name });

    res.json({ message: '已将 ' + studentId + ' (' + s.name + ') 提升为班委，该学生需重新登录后生效' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};

// 将班委降级为普通学生
exports.demoteFromAssistant = async (req, res) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: '请输入学号' });

    const [students] = await pool.query('SELECT s.*, u.id as uid FROM students s JOIN users u ON s.user_id = u.id WHERE s.student_id = ? AND s.is_assistant = TRUE', [studentId]);
    if (students.length === 0) {
      return res.status(400).json({ error: '该学号不是班委' });
    }

    await assertCounselorStudentScope(req, students[0]);

    await pool.query("UPDATE students SET is_assistant = FALSE WHERE student_id = ?", [studentId]);
    await pool.query("UPDATE users SET token_version = token_version + 1 WHERE id = ?", [students[0].uid]);
    try {
      await releaseAssistantAssignments(students[0].uid, students[0].class_name, students[0].grade);
    } catch (assignErr) {
      console.error('撤销班委后的待审任务重分配失败:', assignErr.message);
    }
    await auditLog(req, 'assistant.demote', 'user', students[0].uid, { studentId });

    res.json({ message: '已将 ' + studentId + ' 降级为普通学生，该学生需重新登录后生效' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
};
