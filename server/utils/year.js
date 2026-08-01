const pool = require('../config/database');

async function getCurrentYearId(rawYearId) {
  // 如果包含连字符，说明是学年名称（如 '2025-2026'），按名称查找
  if (rawYearId && String(rawYearId).includes('-')) {
    const [rows] = await pool.query('SELECT id FROM academic_years WHERE name = ?', [rawYearId]);
    if (rows[0]) return rows[0].id;
  }

  // 纯数字 → 当作 ID 使用
  const numericId = parseInt(rawYearId);
  if (numericId > 0 && numericId < 100) return numericId;

  // 兜底：取当前学年
  const [currentRows] = await pool.query(
    'SELECT id FROM academic_years WHERE is_current = TRUE ORDER BY id DESC LIMIT 1'
  );
  if (currentRows[0]) return currentRows[0].id;

  const [latestRows] = await pool.query('SELECT id FROM academic_years ORDER BY id DESC LIMIT 1');
  if (latestRows[0]) return latestRows[0].id;

  throw new Error('未配置学年');
}

module.exports = { getCurrentYearId };
