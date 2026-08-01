-- 注册班级以“学院 + 年级 + 专业 + 班级”为唯一范围。
-- 班级文本本身不保存年级，避免 24物联网工程1班 与 2024级物联网工程一班并存。

ALTER TABLE class_options
  ADD COLUMN grade VARCHAR(20) NULL AFTER college_id;

UPDATE class_options co
SET grade = COALESCE(
  (
    SELECT s.grade
    FROM students s
    WHERE s.class_name = co.class_name
      AND (co.major = '' OR s.major = co.major)
      AND s.grade IS NOT NULL AND s.grade <> ''
    ORDER BY s.id
    LIMIT 1
  ),
  (
    SELECT t.grade
    FROM teacher_classes tc
    JOIN teachers t ON t.id = tc.teacher_id
    WHERE tc.class_name = co.class_name
      AND t.grade IS NOT NULL AND t.grade <> ''
    ORDER BY t.id
    LIMIT 1
  ),
  '未设置'
)
WHERE grade IS NULL OR grade = '';

ALTER TABLE class_options DROP INDEX uk_class_options;
ALTER TABLE class_options
  MODIFY grade VARCHAR(20) NOT NULL,
  ADD UNIQUE KEY uk_class_options (college_id, grade, major, class_name),
  ADD INDEX idx_class_options_scope (grade, major, class_name);
