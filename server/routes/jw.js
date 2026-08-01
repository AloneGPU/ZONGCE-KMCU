/**
 * 教务系统成绩导入接口
 *   POST /api/jw/my             — 学生用自己的 JWT + 教务密码自动导入
 *   POST /api/jw/scrape         — 管理员/辅导员手动导入单个学生
 *   POST /api/jw/batch-scrape   — 管理员/辅导员批量导入班级
 */
const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { spawn } = require('child_process');
const path = require('path');
const pool = require('../config/database');

function runScraper(username, password, year) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'utils', 'jw_scraper.py');
    const args = [scriptPath, username];
    if (year) args.push('--year', year);

    const proc = spawn('python', args, {
      cwd: path.join(__dirname, '..', '..'),
      timeout: 120000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.stdin.write(password);
    proc.stdin.end();
    proc.on('close', () => {
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error('爬虫解析失败: ' + (stderr || stdout).substring(0, 200))); }
    });
    proc.on('error', err => reject(new Error('爬虫启动失败: ' + err.message)));
  });
}

// 核心：爬取 + 导入数据库
async function fetchAndImport(studentId, studentCode, password, year, userId) {
  const result = await runScraper(studentCode, password, year);
  if (!result.success) throw new Error(result.error || '教务系统爬取失败');

  let importedCount = 0;
  const details = [];

  for (const [academicYear, group] of Object.entries(result.semesters || {})) {
    const [yearRows] = await pool.query('SELECT id FROM academic_years WHERE name = ?', [academicYear]);
    if (yearRows.length === 0) continue;
    const yearId = yearRows[0].id;

    const [modRows] = await pool.query("SELECT id FROM scoring_modules WHERE name = '智育'");
    if (modRows.length === 0) continue;
    const moduleId = modRows[0].id;

    const [itemRows] = await pool.query(
      "SELECT id FROM scoring_items WHERE module_id = ? AND name = '学业成绩'", [moduleId]
    );
    if (itemRows.length === 0) continue;

    const avg = group.weightedAvg;
    if (avg && avg > 0) {
      await pool.query(
        `INSERT INTO imported_scores (student_id, academic_year_id, module_id, item_id, score, source, imported_by)
         VALUES (?, ?, ?, ?, ?, 'jw_scraper', ?)
         ON DUPLICATE KEY UPDATE score = VALUES(score), source = 'jw_scraper'`,
        [studentId, yearId, moduleId, itemRows[0].id, avg, userId]
      );
      importedCount++;
      details.push({ year: academicYear, weightedAvg: avg, requiredCredits: group.requiredCredits, courses: group.courseCount });
    }
  }

  // 更新姓名
  if (result.studentName && result.studentName.length > 0 && result.studentName.length < 30) {
    await pool.query('UPDATE students SET name = ? WHERE id = ?', [result.studentName, studentId]);
  }

  return { importedCount, totalCourses: result.totalCourses, studentName: result.studentName || '', details };
}

// ==================== 学生自己导入（用 JWT 身份） ====================
router.post('/my', authenticate, requireRole('student'), async (req, res) => {
  try {
    const { password, year } = req.body;
    if (!password) return res.status(400).json({ error: '请输入教务系统密码' });

    const [self] = await pool.query('SELECT * FROM students WHERE user_id = ?', [req.user.userId]);
    if (self.length === 0) return res.status(400).json({ error: '未找到学生信息' });

    // 5 分钟内防重复
    const [recent] = await pool.query(
      "SELECT MAX(created_at) as t FROM imported_scores WHERE student_id = ? AND source = 'jw_scraper'",
      [self[0].id]
    );
    if (recent[0].t) {
      const min = (Date.now() - new Date(recent[0].t).getTime()) / 60000;
      if (min < 5) return res.status(429).json({ error: '5 分钟内已导入过，请稍后再试' });
    }

    const data = await fetchAndImport(self[0].id, self[0].student_id, password, year, req.user.userId);
    res.json({
      message: `智育成绩导入成功！${data.totalCourses} 门课程`,
      ...data,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== 管理员/辅导员手动导入单个学生 ====================
router.post('/scrape', authenticate, requireRole('admin', 'counselor'), async (req, res) => {
  try {
    const { studentCode, password, year } = req.body;
    if (!studentCode || !password) return res.status(400).json({ error: '请提供学号和教务密码' });

    const [students] = await pool.query('SELECT * FROM students WHERE student_id = ?', [studentCode]);
    if (students.length === 0) return res.status(400).json({ error: '学号 ' + studentCode + ' 不在系统中' });

    const data = await fetchAndImport(students[0].id, studentCode, password, year, req.user.userId);
    res.json({ message: `成功导入 ${studentCode} 的智育成绩`, ...data });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================== 批量导入班级 ====================
router.post('/batch-scrape', authenticate, requireRole('admin', 'counselor'), async (req, res) => {
  try {
    const { className, year, unifiedPassword } = req.body;
    if (!className || !unifiedPassword) return res.status(400).json({ error: '请指定班级和统一密码' });

    const [students] = await pool.query('SELECT * FROM students WHERE class_name = ?', [className]);
    if (students.length === 0) return res.status(400).json({ error: '该班级没有学生' });

    const results = { success: [], failed: [] };
    for (const s of students) {
      try {
        const data = await fetchAndImport(s.id, s.student_id, unifiedPassword, year, req.user.userId);
        results.success.push({ studentCode: s.student_id, name: data.studentName, courses: data.totalCourses, avg: data.details[0]?.weightedAvg || 0 });
      } catch (e) {
        results.failed.push({ studentCode: s.student_id, error: e.message });
      }
      await new Promise(r => setTimeout(r, 1500)); // 节流
    }

    res.json({ message: `导入完成: ${results.success.length} 成功, ${results.failed.length} 失败`, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
