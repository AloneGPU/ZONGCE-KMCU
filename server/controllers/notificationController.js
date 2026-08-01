const pool = require('../config/database');

async function getEffectiveRole(req) {
  if (req.user.role !== 'student') return req.user.role;
  const [rows] = await pool.query('SELECT is_assistant FROM students WHERE user_id = ?', [req.user.userId]);
  return rows[0] && rows[0].is_assistant ? 'assistant' : 'student';
}

// 获取当前用户可见的公告
exports.getAnnouncements = async (req, res) => {
  try {
    const role = await getEffectiveRole(req);
    const [rows] = await pool.query(
      `SELECT * FROM announcements
       WHERE visibility = 'all' OR visibility = ? OR target_user_id = ?
       ORDER BY created_at DESC LIMIT 20`,
      [role, req.user.userId]
    );
    res.json({ announcements: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 发布公告
exports.createAnnouncement = async (req, res) => {
  try {
    const { title, content, visibility, targetUserId } = req.body;
    const cleanTitle = String(title || '').trim();
    const cleanContent = String(content || '').trim();
    const allowedVisibility = new Set(['all', 'admin', 'counselor', 'assistant', 'student']);
    if (!cleanTitle || !cleanContent) return res.status(400).json({ error: '标题和内容不能为空' });
    if (cleanTitle.length > 200 || cleanContent.length > 10000) {
      return res.status(400).json({ error: '公告标题或内容过长' });
    }
    if (!allowedVisibility.has(visibility || 'all')) {
      return res.status(400).json({ error: '公告可见范围无效' });
    }

    const role = await getEffectiveRole(req);
    if (role !== 'admin') return res.status(403).json({ error: '只有管理员可以发布系统公告' });

    const parsedTargetUserId = targetUserId ? Number(targetUserId) : null;
    if (parsedTargetUserId && (!Number.isInteger(parsedTargetUserId) || parsedTargetUserId <= 0)) {
      return res.status(400).json({ error: '定向用户无效' });
    }
    if (parsedTargetUserId) {
      const [targets] = await pool.query('SELECT id FROM users WHERE id = ?', [parsedTargetUserId]);
      if (targets.length === 0) return res.status(400).json({ error: '定向用户不存在' });
    }

    const senderName = req.user.name || '';
    const [result] = await pool.query(
      `INSERT INTO announcements (title, content, sender_id, sender_name, sender_role, visibility, target_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cleanTitle, cleanContent, req.user.userId, senderName, role, visibility || 'all', parsedTargetUserId]
    );
    res.status(201).json({ id: result.insertId, message: '发布成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 删除公告
exports.deleteAnnouncement = async (req, res) => {
  try {
    const [row] = await pool.query('SELECT * FROM announcements WHERE id = ?', [req.params.id]);
    if (row.length === 0) return res.status(404).json({ error: '公告不存在' });
    // 只能删自己发的
    if (row[0].sender_id !== req.user.userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权删除他人的公告' });
    }
    await pool.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
