ALTER TABLE submissions
  ADD COLUMN assistant_assignee_id INT DEFAULT NULL AFTER assistant_reviewer_id;

ALTER TABLE submissions
  ADD CONSTRAINT fk_submissions_assistant_assignee
  FOREIGN KEY (assistant_assignee_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_submissions_assignee_status
  ON submissions(assistant_assignee_id, status);
