-- 023: 评分模块基础分配置化
-- 将原先代码中硬编码的"60分基础分模块"(德育/能力/美育/劳动)下沉到数据库,
-- 便于日后调整各模块基础分, 前后端与导出统一从 scoring_modules.base_score 读取。

ALTER TABLE scoring_modules
  ADD COLUMN base_score TINYINT NOT NULL DEFAULT 0 AFTER weight;

-- 按名称对齐现有基础分规则 (德育=1, 能力=4, 美育=5, 劳动=6 均为 60 分基础)
UPDATE scoring_modules SET base_score = 60
WHERE name IN ('德育', '能力', '美育', '劳动', '劳育');