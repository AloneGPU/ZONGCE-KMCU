-- 再次统一历史班级字段，兼容 MySQL 5.7：不使用 REGEXP_REPLACE。
-- 目标：24物联网工程1班 / 2024级物联网工程一班 -> 物联网工程1班。

UPDATE students
SET class_name = CASE
  WHEN class_name REGEXP '^20[0-9]{2}级' THEN SUBSTRING(class_name, 6)
  WHEN class_name REGEXP '^20[0-9]{2}' THEN SUBSTRING(class_name, 5)
  WHEN class_name REGEXP '^[0-9]{2}级' THEN SUBSTRING(class_name, 4)
  WHEN class_name REGEXP '^[0-9]{2}' THEN SUBSTRING(class_name, 3)
  ELSE class_name
END
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

UPDATE students SET class_name = REPLACE(class_name, '一班', '1班') WHERE class_name LIKE '%一班';
UPDATE students SET class_name = REPLACE(class_name, '二班', '2班') WHERE class_name LIKE '%二班';
UPDATE students SET class_name = REPLACE(class_name, '三班', '3班') WHERE class_name LIKE '%三班';
UPDATE students SET class_name = REPLACE(class_name, '四班', '4班') WHERE class_name LIKE '%四班';
UPDATE students SET class_name = REPLACE(class_name, '五班', '5班') WHERE class_name LIKE '%五班';

INSERT IGNORE INTO teacher_classes (teacher_id, class_name)
SELECT teacher_id,
  CASE
    WHEN class_name REGEXP '^20[0-9]{2}级' THEN SUBSTRING(class_name, 6)
    WHEN class_name REGEXP '^20[0-9]{2}' THEN SUBSTRING(class_name, 5)
    WHEN class_name REGEXP '^[0-9]{2}级' THEN SUBSTRING(class_name, 4)
    WHEN class_name REGEXP '^[0-9]{2}' THEN SUBSTRING(class_name, 3)
    ELSE class_name
  END
FROM teacher_classes
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';
DELETE FROM teacher_classes WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

INSERT IGNORE INTO class_options (college_id, major, class_name, is_active)
SELECT college_id, major,
  CASE
    WHEN class_name REGEXP '^20[0-9]{2}级' THEN SUBSTRING(class_name, 6)
    WHEN class_name REGEXP '^20[0-9]{2}' THEN SUBSTRING(class_name, 5)
    WHEN class_name REGEXP '^[0-9]{2}级' THEN SUBSTRING(class_name, 4)
    WHEN class_name REGEXP '^[0-9]{2}' THEN SUBSTRING(class_name, 3)
    ELSE class_name
  END,
  is_active
FROM class_options
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';
DELETE FROM class_options WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

UPDATE class_change_requests
SET class_name = CASE
  WHEN class_name REGEXP '^20[0-9]{2}级' THEN SUBSTRING(class_name, 6)
  WHEN class_name REGEXP '^20[0-9]{2}' THEN SUBSTRING(class_name, 5)
  WHEN class_name REGEXP '^[0-9]{2}级' THEN SUBSTRING(class_name, 4)
  WHEN class_name REGEXP '^[0-9]{2}' THEN SUBSTRING(class_name, 3)
  ELSE class_name
END
WHERE class_name REGEXP '^(20[0-9]{2}|[0-9]{2})级?';

UPDATE teacher_classes SET class_name = REPLACE(class_name, '一班', '1班') WHERE class_name LIKE '%一班';
UPDATE teacher_classes SET class_name = REPLACE(class_name, '二班', '2班') WHERE class_name LIKE '%二班';
UPDATE teacher_classes SET class_name = REPLACE(class_name, '三班', '3班') WHERE class_name LIKE '%三班';
UPDATE teacher_classes SET class_name = REPLACE(class_name, '四班', '4班') WHERE class_name LIKE '%四班';
UPDATE teacher_classes SET class_name = REPLACE(class_name, '五班', '5班') WHERE class_name LIKE '%五班';

UPDATE class_options SET class_name = REPLACE(class_name, '一班', '1班') WHERE class_name LIKE '%一班';
UPDATE class_options SET class_name = REPLACE(class_name, '二班', '2班') WHERE class_name LIKE '%二班';
UPDATE class_options SET class_name = REPLACE(class_name, '三班', '3班') WHERE class_name LIKE '%三班';
UPDATE class_options SET class_name = REPLACE(class_name, '四班', '4班') WHERE class_name LIKE '%四班';
UPDATE class_options SET class_name = REPLACE(class_name, '五班', '5班') WHERE class_name LIKE '%五班';

UPDATE class_change_requests SET class_name = REPLACE(class_name, '一班', '1班') WHERE class_name LIKE '%一班';
UPDATE class_change_requests SET class_name = REPLACE(class_name, '二班', '2班') WHERE class_name LIKE '%二班';
UPDATE class_change_requests SET class_name = REPLACE(class_name, '三班', '3班') WHERE class_name LIKE '%三班';
UPDATE class_change_requests SET class_name = REPLACE(class_name, '四班', '4班') WHERE class_name LIKE '%四班';
UPDATE class_change_requests SET class_name = REPLACE(class_name, '五班', '5班') WHERE class_name LIKE '%五班';
