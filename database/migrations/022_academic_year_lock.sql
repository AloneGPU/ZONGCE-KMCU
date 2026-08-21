-- 学年锁定与截止期限：让“归档锁死/切换主学年/截止日”真正持久化到数据库
ALTER TABLE academic_years ADD COLUMN is_locked TINYINT(1) NOT NULL DEFAULT 0 AFTER is_current;
ALTER TABLE academic_years ADD COLUMN deadline DATE NULL AFTER is_locked;