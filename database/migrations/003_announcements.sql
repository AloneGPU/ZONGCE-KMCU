-- 通知/公告表
CREATE TABLE IF NOT EXISTS announcements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  sender_id INT NOT NULL,
  sender_name VARCHAR(50) NOT NULL,
  sender_role VARCHAR(20) NOT NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'all', -- all / admin / counselor / assistant / student
  target_user_id INT DEFAULT NULL,               -- 私信目标用户
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO announcements (title, content, sender_id, sender_name, sender_role, visibility) VALUES
('系统已就绪', '综测管理平台 V2 已部署完成。管理员和辅导员可通过此系统发布通知。', 1, '系统管理员', 'admin', 'all');
