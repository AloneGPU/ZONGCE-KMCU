-- 学号前两位代表入学年级，如 24170025 => 2024级。
-- 重新回填历史学生年级，保证注册、导入、列表展示口径一致。

UPDATE students
SET grade = CONCAT('20', SUBSTRING(student_id, 1, 2), '级')
WHERE student_id REGEXP '^[0-9]{2}[0-9]{4,}$'
  AND (
    grade IS NULL
    OR grade = ''
    OR grade <> CONCAT('20', SUBSTRING(student_id, 1, 2), '级')
  );
