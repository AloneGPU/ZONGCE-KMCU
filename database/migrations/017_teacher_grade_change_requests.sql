-- 扩展辅导员变更申请：支持管理年级变更申请。

ALTER TABLE class_change_requests
  ADD COLUMN request_type VARCHAR(20) NOT NULL DEFAULT 'class' COMMENT 'class / grade' AFTER teacher_name,
  ADD COLUMN grade VARCHAR(20) DEFAULT NULL AFTER class_name;
