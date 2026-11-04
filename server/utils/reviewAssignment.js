const crypto = require('crypto');
const pool = require('../config/database');
const { standardizeClassNameForDisplay, normalizeGrade } = require('./className');

function assignmentLockName(className, grade) {
  const scope = `${normalizeGrade(grade)}|${standardizeClassNameForDisplay(className)}`;
  return `zongce:review:${crypto.createHash('sha1').update(scope).digest('hex')}`;
}

async function assignPendingForClass(className, grade) {
  const cleanClassName = standardizeClassNameForDisplay(className);
  const cleanGrade = normalizeGrade(grade);
  if (!cleanClassName || !cleanGrade) return { assigned: 0, assistants: 0 };

  const conn = await pool.getConnection();
  const lockName = assignmentLockName(cleanClassName, cleanGrade);
  let hasLock = false;
  try {
    const [[lockResult]] = await conn.query('SELECT GET_LOCK(?, 5) AS acquired', [lockName]);
    hasLock = Number(lockResult.acquired) === 1;
    if (!hasLock) throw new Error('评审任务正在分配，请稍后刷新');

    await conn.beginTransaction();
    const [assistants] = await conn.query(
      `SELECT DISTINCT u.id AS user_id
       FROM students s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN assistant_review_scopes ars ON ars.user_id = u.id
       WHERE s.is_assistant = TRUE AND (
         (s.class_name = ? AND s.grade = ?)
         OR (ars.class_name = ? AND ars.grade = ?)
       )
       ORDER BY u.id
       FOR UPDATE`,
      [cleanClassName, cleanGrade, cleanClassName, cleanGrade]
    );
    const assistantIds = assistants.map(item => Number(item.user_id));
    if (assistantIds.length === 0) {
      await conn.commit();
      return { assigned: 0, assistants: 0 };
    }

    const placeholders = assistantIds.map(() => '?').join(',');
    await conn.query(
      `UPDATE submissions sub
       JOIN students s ON s.id = sub.student_id
       SET sub.assistant_assignee_id = NULL
       WHERE sub.status = 'pending' AND s.class_name = ? AND s.grade = ?
         AND sub.assistant_assignee_id IS NOT NULL
         AND sub.assistant_assignee_id NOT IN (${placeholders})`,
      [cleanClassName, cleanGrade, ...assistantIds]
    );

    const [loadRows] = await conn.query(
      `SELECT assistant_assignee_id AS user_id, COUNT(*) AS total
       FROM submissions
       WHERE status = 'pending' AND assistant_assignee_id IN (${placeholders})
       GROUP BY assistant_assignee_id`,
      assistantIds
    );
    const loads = new Map(assistantIds.map(id => [id, 0]));
    loadRows.forEach(row => loads.set(Number(row.user_id), Number(row.total)));

    const [pending] = await conn.query(
      `SELECT sub.id
       FROM submissions sub
       JOIN students s ON s.id = sub.student_id
       WHERE sub.status = 'pending' AND sub.assistant_assignee_id IS NULL
         AND s.class_name = ? AND s.grade = ?
       ORDER BY sub.submit_at, sub.id
       FOR UPDATE`,
      [cleanClassName, cleanGrade]
    );

    let assigned = 0;
    for (const submission of pending) {
      const minimum = Math.min(...assistantIds.map(id => loads.get(id) || 0));
      const candidates = assistantIds.filter(id => (loads.get(id) || 0) === minimum);
      const assigneeId = candidates[crypto.randomInt(candidates.length)];
      const [result] = await conn.query(
        `UPDATE submissions SET assistant_assignee_id = ?
         WHERE id = ? AND status = 'pending' AND assistant_assignee_id IS NULL`,
        [assigneeId, submission.id]
      );
      if (result.affectedRows === 1) {
        loads.set(assigneeId, (loads.get(assigneeId) || 0) + 1);
        assigned += 1;
      }
    }

    await conn.commit();
    return { assigned, assistants: assistantIds.length };
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* no active transaction */ }
    throw err;
  } finally {
    if (hasLock) {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [lockName]); } catch (_) { /* connection cleanup */ }
    }
    conn.release();
  }
}

async function releaseAssistantAssignments(userId, className, grade) {
  await pool.query(
    `UPDATE submissions SET assistant_assignee_id = NULL
     WHERE assistant_assignee_id = ? AND status = 'pending'`,
    [userId]
  );
  return assignPendingForClass(className, grade);
}

module.exports = { assignPendingForClass, releaseAssistantAssignments };
