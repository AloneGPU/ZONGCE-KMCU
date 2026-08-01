/**
 * MySQL 数据库初始化脚本
 * 运行: node server/config/initDb.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function initDatabase() {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowReset = process.env.ALLOW_DATABASE_RESET === 'true';
  if (isProduction && !allowReset) {
    throw new Error('生产环境禁止执行 db:init；如确认要重建整个数据库，请临时设置 ALLOW_DATABASE_RESET=true');
  }

  const databaseName = process.env.DB_NAME || 'zongce';
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error('DB_NAME 只能包含字母、数字和下划线');
  }
  const adminPassword = String(process.env.INIT_ADMIN_PASSWORD || process.env.INIT_DEFAULT_PASSWORD || '');
  if (adminPassword.length < 8) {
    throw new Error('请设置至少 8 位的 INIT_ADMIN_PASSWORD（或 INIT_DEFAULT_PASSWORD）后再初始化数据库');
  }
  const legacySchemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
  const schemaPath = fs.existsSync(legacySchemaPath)
    ? legacySchemaPath
    : path.join(__dirname, '..', '..', 'database', 'schema', '000_schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  console.log('正在初始化 MySQL 数据库...');
  console.log(`数据库: ${databaseName}@${process.env.DB_HOST}:${process.env.DB_PORT}`);

  // 先连接 MySQL（不指定数据库），先建库
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true,
    });
    console.log('MySQL 连接成功 ✓');
  } catch (err) {
    console.error('MySQL 连接失败:', err.message);
    process.exit(1);
  }

  try {
    // 建库
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log('数据库创建/确认成功 ✓');

    // 切换到目标数据库
    await conn.query(`USE \`${databaseName}\``);

    const [existingTables] = await conn.query('SHOW TABLES');
    if (existingTables.length > 0 && !allowReset) {
      throw new Error(`数据库 ${databaseName} 已包含 ${existingTables.length} 张表，db:init 已拒绝执行；日常升级请使用 npm run db:migrate`);
    }

    // 按分号分割执行每条语句（跳过空语句和注释）
    const statements = sql
      .replace(/--.*$/gm, '')  // 去单行注释
      .replace(/\/\*[\s\S]*?\*\//g, '')  // 去多行注释
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .filter(s => !/^USE\s+/i.test(s))  // 跳过 USE 语句（已手动执行）
      .filter(s => !/^CREATE\s+DATABASE/i.test(s));  // 跳过 CREATE DATABASE

    for (let index = 0; index < statements.length; index += 1) {
      try {
        await conn.query(statements[index]);
      } catch (e) {
        throw new Error(`第 ${index + 1} 条初始化语句执行失败: ${e.message}`);
      }
    }
    console.log('数据库表结构创建成功 ✓');

    // 验证
    const [tables] = await conn.query('SHOW TABLES');
    const tableKey = Object.keys(tables[0] || {})[0];
    const tableNames = tables.map(t => t[tableKey]);
    console.log(`\n已创建 ${tableNames.length} 张表:`);
    tableNames.forEach(t => console.log(`  - ${t}`));

    // === 动态生成正确的 bcrypt 密码哈希 ===
    const bcrypt = require('bcryptjs');
    const hashAdmin = bcrypt.hashSync(adminPassword, 10);
    await conn.query("UPDATE users SET password_hash = ? WHERE account = 'admin'", [hashAdmin]);
    console.log('初始管理员密码哈希已设置 ✓');

    // 验证用户数据
    const [users] = await conn.query('SELECT account, role, name FROM users');
    console.log(`\n已创建 ${users.length} 个用户:`);
    users.forEach(u => console.log(`  ${u.role.padEnd(12)} ${u.account.padEnd(16)} ${u.name}`));

    console.log('\nMySQL 数据库初始化完成！');
    console.log('请使用管理员账号 admin 和环境变量中配置的初始密码登录。');
    console.log('教师和学生可通过后台导入，学生也可通过注册入口创建本地账号。');

    await conn.end();
    process.exit(0);
  } catch (err) {
    console.error('\n❌ 数据库初始化失败:', err.message);
    await conn.end();
    process.exit(1);
  }
}

initDatabase().catch(err => {
  console.error('\n数据库初始化已终止:', err.message);
  process.exit(1);
});
