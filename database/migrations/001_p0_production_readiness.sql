ALTER TABLE users
  ADD COLUMN token_version INT NOT NULL DEFAULT 0;

ALTER TABLE submissions
  ADD COLUMN rejection_reason TEXT;

CREATE TABLE IF NOT EXISTS audit_logs (
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

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
