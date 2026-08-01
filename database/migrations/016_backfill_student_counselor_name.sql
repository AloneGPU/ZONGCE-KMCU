-- 按教师负责班级回填学生辅导员姓名，修复历史导入学生未配置 counselor_name 的情况。

UPDATE students s
JOIN teacher_classes tc ON tc.class_name = s.class_name
JOIN teachers t ON t.id = tc.teacher_id
SET s.counselor_name = t.name
WHERE s.class_name IS NOT NULL
  AND s.class_name <> ''
  AND (s.counselor_name IS NULL OR s.counselor_name = '');
