-- 兼容微信/移动端超长 User-Agent，避免审计日志写入失败
ALTER TABLE audit_logs MODIFY COLUMN user_agent TEXT;
