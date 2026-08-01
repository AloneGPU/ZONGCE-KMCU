const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME || 'zongce',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: Math.max(1, parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 20),
  queueLimit: 0,
});

// 测试连接
pool.query('SELECT 1')
  .then(() => console.log('MySQL 数据库连接成功'))
  .catch(err => console.error('数据库连接失败:', err.message));

module.exports = pool;
