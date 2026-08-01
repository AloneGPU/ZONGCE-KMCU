-- 专业班级选项与邮箱验证码。

CREATE TABLE IF NOT EXISTS class_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  college_id INT,
  major VARCHAR(100) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_class_options (major, class_name),
  FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(120) NOT NULL,
  purpose VARCHAR(20) NOT NULL,
  code_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_codes_email_purpose (email, purpose),
  INDEX idx_email_codes_expires (expires_at),
  CONSTRAINT chk_email_code_purpose CHECK (purpose IN ('register','reset_password'))
) ENGINE=InnoDB;

INSERT IGNORE INTO class_options (college_id, major, class_name)
SELECT college_id, major, class_name
FROM students
WHERE major IS NOT NULL AND major <> ''
  AND class_name IS NOT NULL AND class_name <> '';
