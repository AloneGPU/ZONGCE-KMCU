-- 班级变更申请表
CREATE TABLE IF NOT EXISTS class_change_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  teacher_name VARCHAR(50) NOT NULL,
  action VARCHAR(10) NOT NULL COMMENT 'add / remove',
  class_name VARCHAR(100) NOT NULL,
  reason TEXT,
  status VARCHAR(20) DEFAULT 'pending' COMMENT 'pending / approved / rejected',
  reviewed_by INT DEFAULT NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
