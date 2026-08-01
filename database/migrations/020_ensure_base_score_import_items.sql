-- 保证六个测评板块都有一个可供 Excel 导入的基础成绩项目。
-- 特别补齐历史库中缺失的“体育体质测试”导入项目。

INSERT INTO scoring_items (module_id, name, max_score, description, evidence, requires_proof, sort_order)
SELECT sm.id, '体质测试成绩', 100, '体育基础成绩（Excel 导入）', '', FALSE, 0
FROM scoring_modules sm
WHERE sm.name = '体育'
  AND NOT EXISTS (
    SELECT 1 FROM scoring_items si
    WHERE si.module_id = sm.id AND si.requires_proof = FALSE
  );
