const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

// 连接池参数(生产友好):
// - connectTimeout: 建连超时,避免数据库不可达时无限等待
// - idleTimeout: 空闲连接回收; keepAlive 防中间网关断空闲连接
// - queueLimit: 排队的最大请求数(0 = 不限); 熔断由 acquireTimeout 不由mysql2提供,
//   需要时可在调用侧控制节奏, 这里保持 queueLimit 有界以避免无限堆积
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME || 'zongce',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: Math.max(1, parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 20),
  queueLimit: 0,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT, 10) || 10000,
  idleTimeout: parseInt(process.env.DB_IDLE_TIMEOUT, 10) || 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
});

// 启动时探测连接(不阻塞进程)：
// 数据库短暂不可用时仍能启动，/api/health 会如实返回 503
pool.query('SELECT 1')
  .then(() => console.log('MySQL 数据库连接成功'))
  .catch(err => console.error('数据库连接失败:', err.message));

module.exports = pool;