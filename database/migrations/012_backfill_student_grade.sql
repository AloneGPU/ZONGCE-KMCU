-- 回填已有学生空年级：优先学号年份，其次专业班级前缀。

UPDATE students
SET grade = CONCAT(SUBSTRING(student_id, 1, 4), '级')
WHERE (grade IS NULL OR grade = '')
  AND student_id REGEXP '^20[0-9]{2}';

UPDATE students
SET grade = CONCAT('20', SUBSTRING(class_name, 1, 2), '级')
WHERE (grade IS NULL OR grade = '')
  AND class_name REGEXP '^[0-9]{2}';

UPDATE students
SET grade = CONCAT(SUBSTRING(class_name, 1, 4), '级')
WHERE (grade IS NULL OR grade = '')
  AND class_name REGEXP '^20[0-9]{2}';
