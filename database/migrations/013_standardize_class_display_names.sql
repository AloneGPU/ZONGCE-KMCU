-- 统一班级显示名：移除开头年级前缀，如 24人工智能1班 -> 人工智能1班。

UPDATE students
SET class_name = REGEXP_REPLACE(class_name, '^(20[0-9]{2}|[0-9]{2})级?', '')
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

INSERT IGNORE INTO teacher_classes (teacher_id, class_name)
SELECT teacher_id, REGEXP_REPLACE(class_name, '^(20[0-9]{2}|[0-9]{2})级?', '')
FROM teacher_classes
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

DELETE FROM teacher_classes
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

INSERT IGNORE INTO class_options (college_id, major, class_name, is_active)
SELECT college_id, major, REGEXP_REPLACE(class_name, '^(20[0-9]{2}|[0-9]{2})级?', ''), is_active
FROM class_options
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

DELETE FROM class_options
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

UPDATE class_change_requests
SET class_name = REGEXP_REPLACE(class_name, '^(20[0-9]{2}|[0-9]{2})级?', '')
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

UPDATE students SET class_name = REPLACE(class_name, '一班', '1班') WHERE class_name LIKE '%一班';
UPDATE students SET class_name = REPLACE(class_name, '二班', '2班') WHERE class_name LIKE '%二班';
UPDATE students SET class_name = REPLACE(class_name, '三班', '3班') WHERE class_name LIKE '%三班';

INSERT IGNORE INTO teacher_classes (teacher_id, class_name)
SELECT teacher_id, REPLACE(class_name, '一班', '1班') FROM teacher_classes WHERE class_name LIKE '%一班';
DELETE FROM teacher_classes WHERE class_name LIKE '%一班';
INSERT IGNORE INTO teacher_classes (teacher_id, class_name)
SELECT teacher_id, REPLACE(class_name, '二班', '2班') FROM teacher_classes WHERE class_name LIKE '%二班';
DELETE FROM teacher_classes WHERE class_name LIKE '%二班';
INSERT IGNORE INTO teacher_classes (teacher_id, class_name)
SELECT teacher_id, REPLACE(class_name, '三班', '3班') FROM teacher_classes WHERE class_name LIKE '%三班';
DELETE FROM teacher_classes WHERE class_name LIKE '%三班';

INSERT IGNORE INTO class_options (college_id, major, class_name, is_active)
SELECT college_id, major, REPLACE(class_name, '一班', '1班'), is_active FROM class_options WHERE class_name LIKE '%一班';
DELETE FROM class_options WHERE class_name LIKE '%一班';
INSERT IGNORE INTO class_options (college_id, major, class_name, is_active)
SELECT college_id, major, REPLACE(class_name, '二班', '2班'), is_active FROM class_options WHERE class_name LIKE '%二班';
DELETE FROM class_options WHERE class_name LIKE '%二班';
INSERT IGNORE INTO class_options (college_id, major, class_name, is_active)
SELECT college_id, major, REPLACE(class_name, '三班', '3班'), is_active FROM class_options WHERE class_name LIKE '%三班';
DELETE FROM class_options WHERE class_name LIKE '%三班';

UPDATE class_change_requests SET class_name = REPLACE(class_name, '一班', '1班') WHERE class_name LIKE '%一班';
UPDATE class_change_requests SET class_name = REPLACE(class_name, '二班', '2班') WHERE class_name LIKE '%二班';
UPDATE class_change_requests SET class_name = REPLACE(class_name, '三班', '3班') WHERE class_name LIKE '%三班';
