const nodemailer = require('nodemailer');

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransporter() {
  if (!hasSmtpConfig()) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: String(process.env.SMTP_SECURE || 'true') !== 'false',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendVerificationCode(email, code, purpose) {
  const title = purpose === 'reset_password' ? '综测系统密码找回验证码' : '综测系统注册验证码';
  const text = `您的验证码是：${code}，10 分钟内有效。若非本人操作，请忽略此邮件。`;

  const transporter = createTransporter();
  if (!transporter) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('邮件服务未配置，请联系管理员配置 SMTP');
    }
    console.log(`[EMAIL_CODE] ${email} ${purpose}: ${code}`);
    return;
  }

  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: title,
    text
  });
}

module.exports = { sendVerificationCode };
