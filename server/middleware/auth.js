const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/auth');
const pool = require('../config/database');

/**
 * JWT 认证中间件 — 验证 Bearer token + token_version 撤销检查
 */
function authenticate(req, res, next) {
  // 如果 tokenFromQuery 中间件已通过 URL token 验证，直接放行
  if (req.user) return next();

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded; // { userId, role, name, v }

    // token_version 撤销检查（管理员删除/禁用账号、用户改密码后旧 token 立即失效）
    if (decoded.v !== undefined) {
      pool.query('SELECT token_version FROM users WHERE id = ?', [decoded.userId])
        .then(([rows]) => {
          if (rows.length === 0 || rows[0].token_version !== decoded.v) {
            return res.status(401).json({ error: '凭证已失效，请重新登录' });
          }
          next();
        })
        .catch(() => res.status(503).json({ error: '认证服务暂时不可用，请稍后重试' }));
    } else {
      next();
    }
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ error: '无效的认证令牌' });
  }
}

module.exports = authenticate;
