-- ============================================
-- 大学生综测管理平台 - MySQL 数据库初始化
-- 适用: MySQL 8.0+
-- ============================================

-- 建库（如果不存在）
CREATE DATABASE IF NOT EXISTS zongce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE zongce;

-- 清理已存在的表（按依赖顺序删除）
DROP TABLE IF EXISTS imported_scores;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS scrape_logs;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS rules_lock;
DROP TABLE IF EXISTS scoring_items;
DROP TABLE IF EXISTS scoring_modules;
DROP TABLE IF EXISTS email_verification_codes;
DROP TABLE IF EXISTS class_change_requests;
DROP TABLE IF EXISTS teacher_classes;
DROP TABLE IF EXISTS teachers;
DROP TABLE IF EXISTS class_options;
DROP TABLE IF EXISTS students;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS academic_years;
DROP TABLE IF EXISTS colleges;
DROP TABLE IF EXISTS schema_migrations;

-- ============================================
-- 1. 学院表
-- ============================================
CREATE TABLE colleges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20) NOT NULL UNIQUE
) ENGINE=InnoDB;

-- ============================================
-- 2. 学年表
-- ============================================
CREATE TABLE academic_years (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL UNIQUE,
  is_current BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================
-- 3. 专业班级选项
-- ============================================
CREATE TABLE class_options (
  id INT AUTO_INCREMENT PRIMARY KEY,
  college_id INT,
  grade VARCHAR(20) NOT NULL,
  major VARCHAR(100) NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_class_options (college_id, grade, major, class_name),
  FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================
-- 4. 用户表（统一认证）
-- ============================================
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL,
  name VARCHAR(50) NOT NULL,
  email VARCHAR(120) DEFAULT NULL,
  token_version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_email (email),
  CONSTRAINT chk_role CHECK (role IN ('admin','counselor','assistant','student'))
) ENGINE=InnoDB;

-- ============================================
-- 5. 教师表（辅导员）
-- ============================================
CREATE TABLE teachers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  employee_id VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL,
  college_id INT,
  grade VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================
-- 6. 教师负责班级
-- ============================================
CREATE TABLE teacher_classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  class_name VARCHAR(100) NOT NULL,
  UNIQUE KEY uk_tc (teacher_id, class_name),
  FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================
-- 7. 学生表
-- ============================================
CREATE TABLE students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  student_id VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL,
  grade VARCHAR(20),
  major VARCHAR(100),
  class_name VARCHAR(100),
  college_id INT,
  gender VARCHAR(10) DEFAULT NULL,
  counselor_name VARCHAR(50) DEFAULT NULL,
  is_assistant BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (college_id) REFERENCES colleges(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================
-- 8. 评分模块
-- ============================================
CREATE TABLE scoring_modules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  weight DECIMAL(5,2) NOT NULL DEFAULT 0,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================
-- 9. 加分项
-- ============================================
CREATE TABLE scoring_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  max_score DECIMAL(10,2) NOT NULL DEFAULT 10,
  description TEXT,
  evidence TEXT,
  requires_proof BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (module_id) REFERENCES scoring_modules(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================
-- 10. 规则锁定表
-- ============================================
CREATE TABLE rules_lock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  is_locked BOOLEAN DEFAULT FALSE,
  locked_by INT,
  locked_at TIMESTAMP NULL,
  FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================
-- 11. 学生提交材料
-- ============================================
CREATE TABLE submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  academic_year_id INT,
  module_id INT,
  item_id INT,
  score DECIMAL(10,2) NOT NULL,
  description TEXT,
  award_month VARCHAR(7) DEFAULT NULL,
  proof_filename VARCHAR(255),
  proof_path VARCHAR(500),
  status VARCHAR(20) DEFAULT 'pending',
  rejection_reason TEXT,
  counselor_reviewer_id INT,
  assistant_reviewer_id INT,
  assistant_assignee_id INT,
  counselor_review_at TIMESTAMP NULL,
  assistant_review_at TIMESTAMP NULL,
  submit_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES scoring_modules(id) ON DELETE SET NULL,
  FOREIGN KEY (item_id) REFERENCES scoring_items(id) ON DELETE SET NULL,
  FOREIGN KEY (counselor_reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assistant_reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (assistant_assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_sub_status CHECK (status IN ('pending','assistant_approved','approved','rejected'))
) ENGINE=InnoDB;

-- ============================================
-- 12. 班级变更申请
-- ============================================
CREATE TABLE class_change_requests (
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

-- ============================================
-- 13. 审计日志
-- ============================================
CREATE TABLE audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  role VARCHAR(20),
  action VARCHAR(80) NOT NULL,
  target_type VARCHAR(80),
  target_id VARCHAR(80),
  detail TEXT,
  ip VARCHAR(80),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================
-- 14. 导入的成绩
-- ============================================
CREATE TABLE imported_scores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  academic_year_id INT,
  module_id INT,
  item_id INT,
  score DECIMAL(10,2) NOT NULL,
  source VARCHAR(50) DEFAULT 'imported',
  imported_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id) REFERENCES academic_years(id) ON DELETE SET NULL,
  FOREIGN KEY (module_id) REFERENCES scoring_modules(id) ON DELETE SET NULL,
  FOREIGN KEY (item_id) REFERENCES scoring_items(id) ON DELETE SET NULL,
  FOREIGN KEY (imported_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_student_year_module_item (student_id, academic_year_id, module_id, item_id)
) ENGINE=InnoDB;

-- ============================================
-- 15. 公告通知
-- ============================================
CREATE TABLE announcements (
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

-- ============================================
-- 16. 历史自动对接日志
-- ============================================
CREATE TABLE scrape_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_code VARCHAR(50) NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  courses INT DEFAULT 0,
  error_msg TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================
-- 17. 邮箱验证码
-- ============================================
CREATE TABLE email_verification_codes (
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

-- ============================================
-- 18. 数据库迁移记录
-- ============================================
CREATE TABLE schema_migrations (
  filename VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================
-- 索引
-- ============================================
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_account ON users(account);
CREATE INDEX idx_class_options_college ON class_options(college_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_students_class ON students(class_name);
CREATE INDEX idx_students_college ON students(college_id);
CREATE INDEX idx_teachers_college ON teachers(college_id);
CREATE INDEX idx_submissions_student ON submissions(student_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_assignee_status ON submissions(assistant_assignee_id, status);
CREATE INDEX idx_submissions_year ON submissions(academic_year_id);
CREATE INDEX idx_imported_scores_student ON imported_scores(student_id);
CREATE INDEX idx_imported_scores_year ON imported_scores(academic_year_id);
CREATE INDEX idx_scoring_items_module ON scoring_items(module_id);
CREATE INDEX idx_teacher_classes ON teacher_classes(teacher_id);
CREATE INDEX idx_class_change_requests_status ON class_change_requests(status);
CREATE INDEX idx_scrape_logs_student ON scrape_logs(student_code);
CREATE INDEX idx_scrape_logs_created ON scrape_logs(created_at);

-- ============================================
-- 初始数据
-- ============================================

-- 学院
INSERT INTO colleges (name, code) VALUES
  ('数据科学与工程学院', 'ds'),
  ('法学院', 'law'),
  ('教育学院', 'edu'),
  ('商学院', 'bs'),
  ('体育学院', 'pe'),
  ('艺术学院', 'arts');

-- 学年
INSERT INTO academic_years (name, is_current) VALUES
  ('2024-2025', FALSE),
  ('2025-2026', TRUE),
  ('2026-2027', FALSE);

-- 根管理员（密码由 db:init 使用 INIT_ADMIN_PASSWORD 动态覆盖）
INSERT INTO users (account, password_hash, role, name) VALUES
  ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin', '系统管理员');

-- 教师和学生由管理员后台导入，学生也可通过注册入口创建本地账号。

-- 默认评分模块
INSERT INTO scoring_modules (name, weight, sort_order) VALUES
  ('德育', 20, 1),
  ('智育', 50, 2),
  ('体育', 10, 3),
  ('美育', 10, 4),
  ('劳育', 10, 5);

-- 默认加分项
INSERT INTO scoring_items (module_id, name, max_score, description, requires_proof, sort_order) VALUES
  (1, '志愿服务', 10, '参加校级及以上志愿服务活动，每次加2分，上限10分', TRUE, 1),
  (1, '学生干部', 8, '班长/团支书8分，班委5分，寝室长2分', TRUE, 2),
  (1, '获奖荣誉', 10, '国家级10分，省级6分，校级3分', TRUE, 3),
  (1, '德育成绩', 100, '德育课程成绩（教师导入）', FALSE, 4),
  (2, '学科竞赛', 15, '国家级一等奖15分，二等奖12分，三等奖10分；省级递减', TRUE, 1),
  (2, '科研论文', 15, 'SCI/EI期刊15分，核心期刊10分，普通期刊5分', TRUE, 2),
  (2, '学业成绩', 100, '必修课加权平均分（Excel导入）', FALSE, 3),
  (3, '体质测试', 100, '体质健康测试成绩（教师导入）', FALSE, 1),
  (3, '体育竞赛', 10, '参加体育竞赛获奖，校级3分，省级6分，国家级10分', TRUE, 2),
  (4, '文艺活动', 8, '参加校级以上文艺演出或展览', TRUE, 1),
  (4, '艺术竞赛', 10, '艺术类竞赛获奖', TRUE, 2),
  (5, '社会实践', 10, '参加暑期社会实践等活动，每次2分', TRUE, 1),
  (5, '劳动教育', 5, '参加劳动教育课程或活动', TRUE, 2);

-- 规则初始状态
INSERT INTO rules_lock (is_locked) VALUES (FALSE);

SELECT '数据库初始化完成！' AS status;
