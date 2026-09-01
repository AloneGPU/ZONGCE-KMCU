-- 体育基础分由“学期体育成绩(最高30) + 体测成绩(最高30)”组成，导入后封顶 60。
-- 只调整可导入项目的规则上限，不修改已有 imported_scores 历史成绩。

UPDATE scoring_items
SET name = '体育基础分（课程+体测）',
    max_score = 60,
    description = '体育基础分（Excel 导入）：学期体育成绩最高30分 + 体测成绩最高30分，合计最高60分',
    evidence = '体育成绩及体测等级汇总表',
    requires_proof = FALSE,
    sort_order = 0
WHERE module_id = 3 AND requires_proof = FALSE;

INSERT INTO scoring_items (module_id, name, max_score, description, evidence, requires_proof, sort_order)
SELECT 3, '体育基础分（课程+体测）', 60,
       '体育基础分（Excel 导入）：学期体育成绩最高30分 + 体测成绩最高30分，合计最高60分',
       '体育成绩及体测等级汇总表', FALSE, 0
WHERE NOT EXISTS (
  SELECT 1 FROM scoring_items WHERE module_id = 3 AND requires_proof = FALSE
);
