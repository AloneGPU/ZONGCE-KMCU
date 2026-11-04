const pool = require('../config/database');

const Submission = {
  async findByStudent(studentId) {
    const [rows] = await pool.query(
      `SELECT sub.*, s.student_id as student_code, s.name as student_name, s.class_name, s.grade,
              sm.name as module_name, si.name as item_name, si.requires_proof,
              ay.name as year_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN scoring_items si ON sub.item_id = si.id
       LEFT JOIN academic_years ay ON sub.academic_year_id = ay.id
       WHERE sub.student_id = ?
       ORDER BY sub.submit_at DESC`, [studentId]
    );
    return rows;
  },

  async findPendingByClass(className, yearId, grade, assigneeUserId) {
    const gradeClause = grade ? ' AND s.grade = ?' : '';
    const assigneeClause = assigneeUserId ? ' AND sub.assistant_assignee_id = ?' : '';
    const params = grade ? [className, yearId, grade] : [className, yearId];
    if (assigneeUserId) params.push(assigneeUserId);
    const [rows] = await pool.query(
      `SELECT sub.*, s.name as student_name, s.student_id as student_code, s.class_name, s.grade, s.college_id,
              sm.name as module_name, si.name as item_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN scoring_items si ON sub.item_id = si.id
       WHERE s.class_name = ? AND sub.academic_year_id = ?${gradeClause}${assigneeClause}
       ORDER BY RAND()`, params
    );
    return rows;
  },

  async findPendingByTeacherClass(classNames, yearId, grade) {
    if (!classNames || classNames.length === 0) return [];
    const placeholders = classNames.map(() => '?').join(',');
    const gradeClause = grade ? ' AND s.grade = ?' : '';
    const params = grade ? [...classNames, yearId, grade] : [...classNames, yearId];
    const [rows] = await pool.query(
      `SELECT sub.*, s.name as student_name, s.student_id as student_code, s.class_name, s.grade, s.college_id,
              sm.name as module_name, si.name as item_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN scoring_items si ON sub.item_id = si.id
       WHERE s.class_name IN (${placeholders}) AND sub.academic_year_id = ?${gradeClause}
      ORDER BY sub.submit_at DESC`, params
    );
    return rows;
  },

  async findByYear(yearId) {
    const [rows] = await pool.query(
      `SELECT sub.*, s.name as student_name, s.student_id as student_code, s.class_name, s.grade, s.college_id,
              sm.name as module_name, si.name as item_name, ay.name as year_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN scoring_items si ON sub.item_id = si.id
       LEFT JOIN academic_years ay ON sub.academic_year_id = ay.id
       WHERE sub.academic_year_id = ?
       ORDER BY sub.submit_at DESC`,
      [yearId]
    );
    return rows;
  },

  async findById(id) {
    const [rows] = await pool.query(
      `SELECT sub.*, s.name as student_name, s.student_id as student_code, s.class_name, s.grade, s.college_id,
              sm.name as module_name, si.name as item_name, ay.name as year_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN scoring_items si ON sub.item_id = si.id
       LEFT JOIN academic_years ay ON sub.academic_year_id = ay.id
       WHERE sub.id = ?`, [id]
    );
    return rows[0] || null;
  },

  // 学生对自己材料的查询：ID + 学生双重条件，防止越权读取他人提交
  async findByIdForStudent(id, studentId) {
    const [rows] = await pool.query(
      `SELECT sub.*, s.name as student_name, s.student_id as student_code, s.class_name, s.grade, s.college_id,
              sm.name as module_name, si.name as item_name, ay.name as year_name
       FROM submissions sub
       JOIN students s ON sub.student_id = s.id
       LEFT JOIN scoring_modules sm ON sub.module_id = sm.id
       LEFT JOIN scoring_items si ON sub.item_id = si.id
       LEFT JOIN academic_years ay ON sub.academic_year_id = ay.id
       WHERE sub.id = ? AND sub.student_id = ?`, [id, studentId]
    );
    return rows[0] || null;
  },

  async create({ studentId, academicYearId, moduleId, itemId, score, description, awardMonth, proofFilename, proofPath, proofFiles, initialStatus }) {
    const status = initialStatus || 'pending';
    const [result] = await pool.query(
      `INSERT INTO submissions (student_id, academic_year_id, module_id, item_id, score, description, award_month, proof_filename, proof_path, proof_files, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [studentId, academicYearId, moduleId, itemId, score, description, awardMonth || null, proofFilename, proofPath, proofFiles || null, status]
    );
    return { id: result.insertId, student_id: studentId, academic_year_id: academicYearId, module_id: moduleId, item_id: itemId, score, description, award_month: awardMonth || null, proof_filename: proofFilename, proof_path: proofPath, proof_files: proofFiles || null, status };
  },

  // 仅允许更新白名单字段（status 仅允许 'rejected'→'pending' 重置）
  async update(id, data, statusList = ['pending', 'rejected']) {
    const allowedFields = ['module_id', 'item_id', 'score', 'description', 'award_month', 'proof_filename', 'proof_path', 'proof_files', 'status', 'rejection_reason', 'assistant_assignee_id', 'assistant_reviewer_id', 'assistant_review_at', 'counselor_reviewer_id', 'counselor_review_at'];
    const fields = [];
    const values = [];
    for (const k of allowedFields) {
      if (data[k] !== undefined) {
        fields.push('`' + k + '` = ?');
        values.push(data[k]);
      }
    }
    if (fields.length === 0) return;
    const statuses = Array.isArray(statusList) && statusList.length > 0 ? statusList : ['pending', 'rejected'];
    values.push(id, ...statuses);
    const [result] = await pool.query(
      'UPDATE submissions SET ' + fields.join(', ') + ' WHERE id = ? AND status IN (' + statuses.map(() => '?').join(',') + ')',
      values
    );
    return result.affectedRows;
  },

  /**
   * 逐级审批逻辑：
   *   助理 approve  → pending → assistant_approved  （必须有助理审批这一步）
   *   辅导员 approve → assistant_approved → approved  （等助理审完才能审）
   *   辅导员在有助理的班级：不能跳过助理直接审批
   *   任一方 reject → rejected
   */
  async approve(id, role, userId, score) {
    // 先获取当前状态
    const [rows] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
    if (rows.length === 0) throw new Error('提交记录不存在');
    const sub = rows[0];

    const hasScore = score !== undefined && score !== null && score !== '';
    const nextScore = hasScore ? Number(score) : Number(sub.score);
    if (!Number.isFinite(nextScore) || nextScore < 0 || nextScore > 9999) {
      throw new Error('核准分数必须是有效的非负数字');
    }

    if (role === 'admin' || role === 'college_admin') {
      const [result] = await pool.query(
        'UPDATE submissions SET score = ?, counselor_reviewer_id = ?, counselor_review_at = NOW(), status = ?, rejection_reason = NULL WHERE id = ? AND status IN (?, ?)',
        [nextScore, userId, 'approved', id, 'pending', 'assistant_approved']
      );
      if (result.affectedRows !== 1) throw new Error('该材料状态已变化，请刷新后重试');
      const [updated] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
      return updated[0];
    }

    if (role === 'assistant') {
      // 助理审批：只能审批 pending 状态的
      if (sub.status !== 'pending') {
        throw new Error('该材料已被审核，无法重复操作');
      }
      if (Number(sub.assistant_assignee_id) !== Number(userId)) {
        throw new Error('该材料未分配给当前班委');
      }
      const [result] = await pool.query(
        'UPDATE submissions SET score = ?, assistant_reviewer_id = ?, assistant_review_at = NOW(), status = ?, rejection_reason = NULL WHERE id = ? AND status = ? AND assistant_assignee_id = ?',
        [nextScore, userId, 'assistant_approved', id, 'pending', userId]
      );
      if (result.affectedRows !== 1) throw new Error('该材料状态已变化，请刷新后重试');
      const [updated] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
      return updated[0];
    }

    if (role === 'counselor') {
      // 辅导员审批
      if (sub.status === 'pending') {
        // pending 状态 → 说明助理还没审。检查这个班级是否有助理
        // 如果有助理且助理未审批，则不能跳过
        const [students] = await pool.query(
          'SELECT s.class_name, s.grade FROM students s WHERE s.id = ?', [sub.student_id]
        );
        if (students.length === 0) throw new Error('学生不存在');
        const className = students[0].class_name;
        const grade = students[0].grade;

        // 查这个班有没有助理（查 students.is_assistant 标记）
        const [assistants] = await pool.query(
          `SELECT s.id FROM students s
           WHERE s.is_assistant = TRUE AND s.class_name = ?
             AND (s.grade = ? OR (s.grade IS NULL AND ? IS NULL))`, [className, grade, grade]
        );

        if (assistants.length > 0) {
          // 有助理，辅导员不能跳过
          throw new Error('该班级有学生助理，请等待助理先审核');
        }
        // 无助理的班级，辅导员可以直接审批
        const [result] = await pool.query(
          'UPDATE submissions SET score = ?, counselor_reviewer_id = ?, counselor_review_at = NOW(), status = ?, rejection_reason = NULL WHERE id = ? AND status = ?',
          [nextScore, userId, 'approved', id, 'pending']
        );
        if (result.affectedRows !== 1) throw new Error('该材料状态已变化，请刷新后重试');
      } else if (sub.status === 'assistant_approved') {
        // 助理已审批，辅导员直接通过
        const [result] = await pool.query(
          'UPDATE submissions SET score = ?, counselor_reviewer_id = ?, counselor_review_at = NOW(), status = ?, rejection_reason = NULL WHERE id = ? AND status = ?',
          [nextScore, userId, 'approved', id, 'assistant_approved']
        );
        if (result.affectedRows !== 1) throw new Error('该材料状态已变化，请刷新后重试');
      } else {
        throw new Error('该材料已被审核，无法重复操作');
      }

      const [updated] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
      return updated[0];
    }

    throw new Error('无效的角色');
  },

  async reject(id, role, userId, reason) {
    const [rows] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
    if (rows.length === 0) throw new Error('提交记录不存在');
    if (rows[0].status === 'approved' || rows[0].status === 'rejected') {
      throw new Error('该材料已被终审，无法修改');
    }
    if (!reason || !String(reason).trim()) {
      throw new Error('拒绝材料必须填写驳回原因');
    }
    if (role === 'assistant' && Number(rows[0].assistant_assignee_id) !== Number(userId)) {
      throw new Error('该材料未分配给当前班委');
    }
    if (role === 'admin' || role === 'college_admin') {
      const [result] = await pool.query(
        `UPDATE submissions SET status = 'rejected', rejection_reason = ?, counselor_reviewer_id = ?, counselor_review_at = NOW()
         WHERE id = ? AND status IN ('pending', 'assistant_approved')`,
        [String(reason).trim(), userId, id]
      );
      if (result.affectedRows !== 1) throw new Error('该材料状态已变化，请刷新后重试');
      const [updated] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
      return updated[0];
    }
    const reviewerField = role === 'assistant' ? 'assistant_reviewer_id' : 'counselor_reviewer_id';
    const reviewAtField = role === 'assistant' ? 'assistant_review_at' : 'counselor_review_at';
    const [result] = await pool.query(
      `UPDATE submissions SET status = 'rejected', rejection_reason = ?, ${reviewerField} = ?, ${reviewAtField} = NOW()
       WHERE id = ? AND status IN ('pending', 'assistant_approved')${role === 'assistant' ? ' AND assistant_assignee_id = ?' : ''}`,
      role === 'assistant'
        ? [String(reason).trim(), userId, id, userId]
        : [String(reason).trim(), userId, id]
    );
    if (result.affectedRows !== 1) throw new Error('该材料状态已变化，请刷新后重试');
    const [updated] = await pool.query('SELECT * FROM submissions WHERE id = ?', [id]);
    return updated[0];
  },

  async delete(id) {
    await pool.query('DELETE FROM submissions WHERE id = ?', [id]);
  },

  async getApprovedScores(studentId, yearId, moduleId) {
    const [rows] = await pool.query(
      `SELECT item_id, score FROM submissions
       WHERE student_id = ? AND academic_year_id = ? AND module_id = ? AND status = 'approved'`,
      [studentId, yearId, moduleId]
    );
    return rows;
  },
};

module.exports = Submission;
