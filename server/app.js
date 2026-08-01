require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

// 路由
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const counselorRoutes = require('./routes/counselor');
const assistantRoutes = require('./routes/assistant');
const studentRoutes = require('./routes/student');
const fileRoutes = require('./routes/files');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(item => item.trim()).filter(Boolean)
  : (isProduction ? false : true);

// 反向代理信任（生产环境在 Nginx 后面时需要）
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY) || 1);
}

if (isProduction) {
  if (!process.env.CORS_ORIGIN) throw new Error('生产环境必须配置 CORS_ORIGIN');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || /change|replace|secret/i.test(process.env.JWT_SECRET)) {
    throw new Error('生产环境 JWT_SECRET 必须是至少 32 位的随机密钥，且不能使用示例值');
  }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('生产环境必须配置 SMTP_HOST、SMTP_USER 和 SMTP_PASS');
  }
  if (!process.env.UPLOAD_ROOT) throw new Error('生产环境必须配置 UPLOAD_ROOT');
}

// ==================== 中间件 ====================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
morgan.token('safe-url', req => req.originalUrl.replace(/([?&]token=)[^&]+/g, '$1[redacted]'));
app.use(morgan(process.env.NODE_ENV === 'production'
  ? ':remote-addr - :remote-user [:date[clf]] ":method :safe-url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
  : ':method :safe-url :status :response-time ms - :res[content-length]'));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || '1mb' }));

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// 全局请求限流（1000 req/15min）
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  message: { error: '请求过于频繁，请稍后再试' }
}));

// 登录接口严格限流（同IP 10次/15min，防撞库）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { error: '登录尝试过于频繁，请15分钟后再试' }
});
app.use('/api/auth/login', loginLimiter);

const publicAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  message: { error: '操作过于频繁，请稍后再试' }
});
app.use('/api/auth/send-code', publicAuthLimiter);
app.use('/api/auth/register', publicAuthLimiter);
app.use('/api/auth/reset-password', publicAuthLimiter);

// 上传材料必须走 /api/files 鉴权接口，禁止被静态目录直接访问。
app.use('/uploads', (_req, res) => {
  res.status(404).json({ error: '文件请通过授权接口访问' });
});

// 带哈希的生产资源长期缓存；index.html 不缓存，确保部署后及时读取新资源。
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: function(res, filePath) {
    if (isProduction && (filePath.endsWith('.js') || filePath.endsWith('.css'))) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  }
}));

// 不再直接暴露上传目录——所有文件通过 /api/files 接口访问（带权限校验）

// ==================== API 路由 ====================
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/counselor', counselorRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/jw', (_req, res) => {
  res.status(410).json({ error: '自动数据对接已停用，请使用 Excel 批量导入' });
});
app.use('/api/announcements', notificationRoutes);

// 公共 API
app.get('/api/health', async (req, res) => {
  try {
    const db = require('./config/database');
    await db.query('SELECT 1');
    res.json({ ok: true, service: 'zongce-platform' });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'database_unavailable' });
  }
});

app.get('/api/colleges', async (req, res) => {
  try {
    const db = require('./config/database');
    const [rows] = await db.query('SELECT * FROM colleges ORDER BY name');
    res.json({ colleges: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/years', async (req, res) => {
  try {
    const db = require('./config/database');
    const [rows] = await db.query('SELECT * FROM academic_years ORDER BY name');
    res.json({ years: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/rules', async (req, res) => {
  try {
    const ScoringRule = require('./models/scoringRule');
    const rules = await ScoringRule.getFullRules();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== 全局错误处理 ====================
app.use((err, req, res, _next) => {
  console.error('服务器错误:', err);

  if (err.message && err.message.includes('不支持的文件格式')) {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '文件大小不能超过 10MB' });
  }

  res.status(500).json({ error: '服务器内部错误' });
});

// ==================== 启动服务器 ====================
app.listen(PORT, () => {
  console.log('\n综测管理平台服务已启动');
  console.log('端口: ' + PORT + '  环境: ' + (process.env.NODE_ENV || 'development'));
  if (process.env.NODE_ENV !== 'production') {
    console.log('默认管理员: admin / admin（请在生产环境中修改）');
  }
});

module.exports = app;
