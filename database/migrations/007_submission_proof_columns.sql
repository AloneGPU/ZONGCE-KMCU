-- 兼容旧库：补齐学生证明图片文件名与相对路径字段
ALTER TABLE submissions ADD COLUMN proof_filename VARCHAR(255) DEFAULT NULL AFTER description;
ALTER TABLE submissions ADD COLUMN proof_path VARCHAR(500) DEFAULT NULL AFTER proof_filename;
