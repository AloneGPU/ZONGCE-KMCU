-- Backfill teacher-user bindings for counselor accounts created before user_id sync was enforced.
UPDATE teachers t
JOIN users u ON u.account = t.employee_id AND u.role = 'counselor'
SET t.user_id = u.id
WHERE t.user_id IS NULL OR t.user_id <> u.id;
