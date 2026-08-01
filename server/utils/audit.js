const pool = require('../config/database');

async function auditLog(req, action, targetType, targetId, detail) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, role, action, target_type, target_id, detail, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user ? req.user.userId : null,
        req.user ? req.user.role : null,
        action,
        targetType || null,
        targetId || null,
        detail ? JSON.stringify(detail).slice(0, 2000) : null,
        req.ip || null,
        (req.headers['user-agent'] || '').substring(0, 1000) || null,
      ]
    );
  } catch (err) {
    console.error('审计日志写入失败:', err.message);
  }
}

module.exports = auditLog;
