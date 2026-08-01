-- 运行所需的非破坏性结构补齐
ALTER TABLE scoring_items ADD COLUMN evidence TEXT AFTER description;

ALTER TABLE students ADD COLUMN gender VARCHAR(10) DEFAULT NULL AFTER college_id;

CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  sender_id INT NOT NULL,
  sender_name VARCHAR(50) NOT NULL,
  sender_role VARCHAR(20) NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'all',
  target_user_id INT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

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

CREATE TABLE IF NOT EXISTS scrape_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_code VARCHAR(50) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  courses INT DEFAULT 0,
  error_msg TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_scrape_logs_student (student_code),
  INDEX idx_scrape_logs_created (created_at)
) ENGINE=InnoDB;
