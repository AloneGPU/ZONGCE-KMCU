/**
 * MySQL 迁移脚本
 * 运行: node server/config/migrate.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function tableExists(conn, tableName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) as total
     FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return rows[0].total > 0;
}

async function columnExists(conn, tableName, columnName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) as total
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return rows[0].total > 0;
}

async function columnInfo(conn, tableName, columnName) {
  const [rows] = await conn.query(
    `SELECT DATA_TYPE as dataType, CHARACTER_MAXIMUM_LENGTH as maxLength
     FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return rows[0] || null;
}

async function migrationSatisfied(conn, file) {
  if (file.startsWith('001_')) {
    return await columnExists(conn, 'users', 'token_version')
      && await columnExists(conn, 'submissions', 'rejection_reason')
      && await tableExists(conn, 'audit_logs');
  }
  if (file.startsWith('002_')) {
    const hasEvidence = await columnExists(conn, 'scoring_items', 'evidence');
    const [rows] = await conn.query("SELECT COUNT(*) as total FROM scoring_modules WHERE id = 6 AND name = '劳动'");
    return hasEvidence && rows[0].total > 0;
  }
  if (file.startsWith('003_')) return await tableExists(conn, 'announcements');
  if (file.startsWith('004_')) return await tableExists(conn, 'class_change_requests');
  if (file.startsWith('005_')) {
    return await columnExists(conn, 'students', 'gender')
      && await columnExists(conn, 'scoring_items', 'evidence')
      && await tableExists(conn, 'announcements')
      && await tableExists(conn, 'class_change_requests')
      && await tableExists(conn, 'scrape_logs');
  }
  if (file.startsWith('006_')) return await columnExists(conn, 'submissions', 'award_month');
  if (file.startsWith('007_')) {
    return await columnExists(conn, 'submissions', 'proof_filename')
      && await columnExists(conn, 'submissions', 'proof_path');
  }
  if (file.startsWith('008_')) {
    const info = await columnInfo(conn, 'audit_logs', 'user_agent');
    return !!info && (['text', 'mediumtext', 'longtext'].includes(String(info.dataType).toLowerCase()) || Number(info.maxLength || 0) >= 1000);
  }
  if (file.startsWith('010_')) {
    return await columnExists(conn, 'users', 'email')
      && await columnExists(conn, 'students', 'counselor_name');
  }
  if (file.startsWith('011_')) {
    return await tableExists(conn, 'class_options')
      && await tableExists(conn, 'email_verification_codes');
  }
  if (file.startsWith('012_')) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) as total FROM students
       WHERE (grade IS NULL OR grade = '')
         AND (student_id REGEXP '^20[0-9]{2}' OR class_name REGEXP '^[0-9]{2}' OR class_name REGEXP '^20[0-9]{2}')`
    );
    return rows[0].total === 0;
  }
  if (file.startsWith('013_')) {
    const [rows] = await conn.query(
      `SELECT
         (SELECT COUNT(*) FROM students WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?') +
         (SELECT COUNT(*) FROM teacher_classes WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?') +
         (SELECT COUNT(*) FROM class_options WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?') AS total`
    );
    return rows[0].total === 0;
  }
  if (file.startsWith('015_submission_')) return await columnExists(conn, 'submissions', 'assistant_assignee_id');
  if (file.startsWith('019_')) return await columnExists(conn, 'class_options', 'grade');
  if (file.startsWith('020_')) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS total
       FROM scoring_items si JOIN scoring_modules sm ON sm.id = si.module_id
       WHERE sm.name = '体育' AND si.requires_proof = FALSE`
    );
    return rows[0].total > 0;
  }
  if (file.startsWith('022_')) {
    return await columnExists(conn, 'academic_years', 'is_locked')
      && await columnExists(conn, 'academic_years', 'deadline');
  }
  if (file.startsWith('023_')) {
    return await columnExists(conn, 'scoring_modules', 'base_score');
  }
  if (file.startsWith('024_')) {
    const [rows] = await conn.query(
      `SELECT COUNT(*) AS total
       FROM scoring_items
       WHERE module_id = 3 AND requires_proof = FALSE AND max_score <= 60`
    );
    return rows[0].total > 0;
  }
  return false;
}

async function hasProtectedData(conn) {
  const [submissionRows] = await conn.query('SELECT COUNT(*) as total FROM submissions');
  const [scoreRows] = await conn.query('SELECT COUNT(*) as total FROM imported_scores');
  return submissionRows[0].total > 0 || scoreRows[0].total > 0;
}

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'zongce',
    multipleStatements: false,
  });

  const migrationsDir = path.join(__dirname, '..', '..', 'database', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`
  );

  for (const file of files) {
    const [applied] = await conn.query('SELECT filename FROM schema_migrations WHERE filename = ?', [file]);
    if (applied.length > 0) {
      console.log('跳过已执行迁移:', file);
      continue;
    }

    if (await migrationSatisfied(conn, file)) {
      await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log('标记已满足迁移:', file);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const destructive = /DELETE\s+FROM\s+(submissions|imported_scores|scoring_items|scoring_modules)/i.test(sql);
    if (destructive && await hasProtectedData(conn) && process.env.ALLOW_DESTRUCTIVE_MIGRATIONS !== 'true') {
      throw new Error(file + ' 包含清空成绩或材料数据的语句。检测到已有数据，已拒绝执行；如确需重置规则，请先备份并设置 ALLOW_DESTRUCTIVE_MIGRATIONS=true');
    }

    const statements = sql
      .replace(/--.*$/gm, '')
      .split(';')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !/^USE\s+/i.test(s));

    console.log('执行迁移:', file);
    for (const stmt of statements) {
      try {
        await conn.query(stmt);
      } catch (err) {
        if (['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME', 'ER_TABLE_EXISTS_ERROR'].includes(err.code)) {
          console.warn('  跳过已存在对象:', err.message);
        } else {
          throw err;
        }
      }
    }
    await conn.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
  }

  await conn.end();
  console.log('数据库迁移完成');
}

migrate().catch(err => {
  console.error('数据库迁移失败:', err.message);
  process.exit(1);
});
