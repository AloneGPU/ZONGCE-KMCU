/**
 * 角色权限中间件 — 限制指定角色访问
 * @param  {...string} roles 允许的角色列表
 * @returns {Function} Express 中间件
 *
 * 用法:
 *   router.use(requireRole('admin'));
 *   router.use(requireRole('admin', 'counselor'));
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: '请先登录' });
    }
    // 'assistant' 是旧角色的兼容：实质仍是 student，拥有 student 全部权限
    var role = req.user.role;
    if (role === 'assistant') role = 'student';
    if (!roles.includes(role)) {
      return res.status(403).json({ error: '权限不足，无法访问此资源' });
    }
    next();
  };
}

function requireScopedAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (!['admin', 'college_admin'].includes(req.user.role)) return res.status(403).json({ error: '权限不足，无法访问此资源' });
  if (req.user.role === 'college_admin' && !req.user.collegeId) return res.status(403).json({ error: '二级管理员未绑定学院' });
  next();
}

module.exports = requireRole;
module.exports.requireScopedAdmin = requireScopedAdmin;
