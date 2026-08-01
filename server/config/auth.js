require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('生产环境必须配置 JWT_SECRET');
}

module.exports = {
  jwtSecret: process.env.JWT_SECRET || 'zongce_dev_secret_key_change_before_deploy',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
};
