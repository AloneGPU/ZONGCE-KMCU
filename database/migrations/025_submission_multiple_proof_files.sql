-- 一条材料可关联多张证明图片。旧 proof_path/proof_filename 继续保留，兼容历史数据。
ALTER TABLE submissions ADD COLUMN proof_files TEXT DEFAULT NULL AFTER proof_path;
