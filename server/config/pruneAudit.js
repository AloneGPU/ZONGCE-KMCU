/**
 * 运维脚本：清理过期审计日志
 * 运行: npm run db:prune-audit [-- --days 180]
 * 说明: audit_logs 只增不删, 长期运行后膨胀。默认删除 180 天前的记录,
 *       时间窗内精确到天, 建议放进 cron 每周执行一次。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mysql = require('mysql2/promise');

async function main() {
  const daysOpt = process.argv.find(a => a.startsWith('--days='));
  const days = daysOpt ? parseInt(daysOpt.split('=')[1], 10) : 180;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('--days 必须是正整数');
  }

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'zongce',
  });

  const [rows] = await conn.query(
    'SELECT COUNT(*) AS total FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)',
    [days]
  );
  const count = rows[0].total;
  if (count === 0) {
    console.log(`近 ${days} 天内无过期审计记录，无需清理`);
    await conn.end();
    return;
  }

  console.log(`将删除 ${days} 天前的审计记录 ${count} 条…`);
  // 清理分块执行，避免一次删除数万行锁表过久
  const CHUNK = 5000;
  let deleted = 0;
  while (true) {
    const [result] = await conn.query(
      `DELETE FROM audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?`,
      [days, CHUNK]
    );
    deleted += result.affectedRows;
    if (result.affectedRows < CHUNK) break;
  }
  console.log(`审计日志清理完成，共删除 ${deleted} 条`);
  await conn.end();
}

main().catch(err => {
  console.error('审计日志清理失败:', err.message);
  process.exit(1);
});