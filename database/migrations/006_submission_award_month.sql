-- 学生材料申报的奖项获得月份（YYYY-MM）
ALTER TABLE submissions ADD COLUMN award_month VARCHAR(7) DEFAULT NULL AFTER description;
