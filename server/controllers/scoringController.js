const ScoringRule = require('../models/scoringRule');
const pool = require('../config/database');
const auditLog = require('../utils/audit');
const Score = require('../models/score');

function parseFiniteNumber(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${label}必须是 ${min} 至 ${max} 之间的数字`);
    error.statusCode = 400;
    throw error;
  }
  return number;
}

function cleanName(value, label) {
  const name = String(value || '').trim();
  if (!name || name.length > 100) {
    const error = new Error(`${label}不能为空且不能超过 100 个字符`);
    error.statusCode = 400;
    throw error;
  }
  return name;
}

async function assertWeightCapacity(weight, excludeModuleId) {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(weight), 0) AS total FROM scoring_modules${excludeModuleId ? ' WHERE id <> ?' : ''}`,
    excludeModuleId ? [excludeModuleId] : []
  );
  if (Number(rows[0].total) + weight > 100) {
    const error = new Error('所有评分模块权重之和不能超过 100%');
    error.statusCode = 400;
    throw error;
  }
}

function sendError(res, err) {
  return res.status(err.statusCode || 500).json({ error: err.message });
}

function isMoralModule(module) {
  return String((module && module.name) || '').trim() === '德育';
}

function isMoralDeductionItem(item) {
  return Boolean(item) && isMoralModule({ name: item.module_name }) && !Boolean(item.requires_proof) && Number(item.max_score) < 0;
}

function normalizeDeductionScore(value, label = '扣分值') {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0 || Math.abs(number) > 1000) {
    const error = new Error(`${label}必须是 0 至 1000 之间的非零数字`);
    error.statusCode = 400;
    throw error;
  }
  return number > 0 ? -number : number;
}

async function getItemWithModule(id) {
  const [rows] = await pool.query(
    `SELECT si.*, sm.name AS module_name
     FROM scoring_items si
     JOIN scoring_modules sm ON sm.id = si.module_id
     WHERE si.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// 获取完整规则
exports.getRules = async (req, res) => {
  try {
    const rules = await ScoringRule.getFullRules();
    res.json(rules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 已废弃——批量更新规则会破坏历史数据关联，不允许此操作。请使用单项修改 API。

// 添加模块
exports.createModule = async (req, res) => {
  try {
    const lock = await ScoringRule.getLockStatus();
    if (lock.is_locked) return res.status(403).json({ error: '规则已锁定' });

    const data = {
      ...req.body,
      name: cleanName(req.body.name, '模块名称'),
      weight: parseFiniteNumber(req.body.weight, '模块权重', 0, 100),
    };
    await assertWeightCapacity(data.weight);
    const mod = await ScoringRule.createModule(data);
    await auditLog(req, 'rules.module.create', 'scoring_module', mod.id, req.body);
    res.status(201).json({ module: mod });
  } catch (err) {
    sendError(res, err);
  }
};

// 修改模块
exports.updateModule = async (req, res) => {
  try {
    const lock = await ScoringRule.getLockStatus();
    if (lock.is_locked) return res.status(403).json({ error: '规则已锁定' });

    const current = await ScoringRule.getModuleById(req.params.id);
    if (!current) return res.status(404).json({ error: '评分模块不存在' });
    const data = { ...req.body };
    if (data.name !== undefined) data.name = cleanName(data.name, '模块名称');
    if (data.weight !== undefined) {
      data.weight = parseFiniteNumber(data.weight, '模块权重', 0, 100);
      await assertWeightCapacity(data.weight, req.params.id);
    }
    const updated = await ScoringRule.updateModule(req.params.id, data);
    if (!updated) return res.status(400).json({ error: '没有可更新的字段' });
    await Score.invalidateBaseScores();
    await auditLog(req, 'rules.module.update', 'scoring_module', req.params.id, req.body);
    res.json({ message: '已更新' });
  } catch (err) {
    sendError(res, err);
  }
};

// 删除模块
exports.deleteModule = async (req, res) => {
  try {
    const lock = await ScoringRule.getLockStatus();
    if (lock.is_locked) return res.status(403).json({ error: '规则已锁定' });

    const [references] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM scoring_items WHERE module_id = ?) AS items,
         (SELECT COUNT(*) FROM submissions WHERE module_id = ?) AS submissions,
         (SELECT COUNT(*) FROM imported_scores WHERE module_id = ?) AS imported`,
      [req.params.id, req.params.id, req.params.id]
    );
    if (Number(references[0].items) + Number(references[0].submissions) + Number(references[0].imported) > 0) {
      return res.status(409).json({ error: '该模块已有加分项或历史成绩，不能删除；可锁定规则后保留历史数据' });
    }
    await ScoringRule.deleteModule(req.params.id);
    await auditLog(req, 'rules.module.delete', 'scoring_module', req.params.id, null);
    res.json({ message: '已删除' });
  } catch (err) {
    sendError(res, err);
  }
};

// 添加加分项
exports.createItem = async (req, res) => {
  try {
    const lock = await ScoringRule.getLockStatus();
    if (lock.is_locked) return res.status(403).json({ error: '规则已锁定' });

    const moduleId = Number(req.body.moduleId);
    if (!Number.isInteger(moduleId) || moduleId <= 0 || !await ScoringRule.getModuleById(moduleId)) {
      return res.status(400).json({ error: '所属评分模块无效' });
    }
    const module = await ScoringRule.getModuleById(moduleId);
    const existingMoralModule = isMoralModule(module);
    const isCounselor = req.user.role === 'counselor';
    if (isCounselor && !existingMoralModule) {
      return res.status(403).json({ error: '辅导员仅可维护德育扣分项' });
    }

    const rawMaxScore = req.body.maxScore;
    const requiresProof = isCounselor
      ? false
      : req.body.requiresProof !== undefined ? Boolean(req.body.requiresProof) : true;
    let maxScore = parseFiniteNumber(rawMaxScore, '加分项分值', -1000, 1000);
    if (existingMoralModule && !requiresProof) {
      maxScore = normalizeDeductionScore(rawMaxScore, '扣分值');
    } else if (maxScore < 0) {
      return res.status(400).json({ error: '非德育扣分项的分值不能为负数' });
    }

    const data = {
      ...req.body,
      name: cleanName(req.body.name, '加分项名称'),
      moduleId,
      maxScore,
      requiresProof: existingMoralModule && !requiresProof ? false : requiresProof,
    };
    if (isCounselor) {
      data.requiresProof = false;
    }
    const item = await ScoringRule.createItem(data);
    await auditLog(req, 'rules.item.create', 'scoring_item', item.id, req.body);
    res.status(201).json({ item });
  } catch (err) {
    sendError(res, err);
  }
};

// 修改加分项
exports.updateItem = async (req, res) => {
  try {
    const lock = await ScoringRule.getLockStatus();
    if (lock.is_locked) return res.status(403).json({ error: '规则已锁定' });

    const current = await getItemWithModule(req.params.id);
    if (!current) return res.status(404).json({ error: '加分项不存在' });
    const module = await ScoringRule.getModuleById(current.module_id);
    const isCounselor = req.user.role === 'counselor';
    if (isCounselor && !isMoralDeductionItem(current)) {
      return res.status(403).json({ error: '辅导员仅可维护德育扣分项' });
    }

    const data = { ...req.body };
    if (data.name !== undefined) data.name = cleanName(data.name, '加分项名称');
    if (data.maxScore !== undefined) {
      if (isMoralModule(module)) {
        const requiresProof = data.requiresProof !== undefined ? Boolean(data.requiresProof) : Boolean(current.requires_proof);
        if (!requiresProof) {
          data.maxScore = normalizeDeductionScore(data.maxScore, '扣分值');
        } else {
          data.maxScore = parseFiniteNumber(data.maxScore, '加分项分值', 0, 1000);
        }
      } else {
        data.maxScore = parseFiniteNumber(data.maxScore, '加分项分值', 0, 1000);
      }
    }
    if (data.moduleId !== undefined) {
      const moduleId = Number(data.moduleId);
      const targetModule = await ScoringRule.getModuleById(moduleId);
      if (!Number.isInteger(moduleId) || moduleId <= 0 || !targetModule) {
        return res.status(400).json({ error: '所属评分模块无效' });
      }
      if (isCounselor && !isMoralModule(targetModule)) {
        return res.status(403).json({ error: '辅导员仅可维护德育扣分项' });
      }
      if (isCounselor && data.requiresProof === true) {
        return res.status(400).json({ error: '德育扣分项不能设置为需要材料审核' });
      }
      data.moduleId = moduleId;
    }
    if (isCounselor) {
      data.requiresProof = false;
    } else if (data.requiresProof !== undefined && isMoralModule(module)) {
      data.requiresProof = Boolean(data.requiresProof);
    }
    const updated = await ScoringRule.updateItem(req.params.id, data);
    if (updated === false) return res.status(404).json({ error: '加分项不存在' });
    await auditLog(req, 'rules.item.update', 'scoring_item', req.params.id, req.body);
    res.json({ message: '已更新' });
  } catch (err) {
    sendError(res, err);
  }
};

// 删除加分项
exports.deleteItem = async (req, res) => {
  try {
    const lock = await ScoringRule.getLockStatus();
    if (lock.is_locked) return res.status(403).json({ error: '规则已锁定' });

    const current = await getItemWithModule(req.params.id);
    if (!current) return res.status(404).json({ error: '加分项不存在' });
    if (req.user.role === 'counselor' && !isMoralDeductionItem(current)) {
      return res.status(403).json({ error: '辅导员仅可删除德育扣分项' });
    }
    const [references] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM submissions WHERE item_id = ?) AS submissions,
         (SELECT COUNT(*) FROM imported_scores WHERE item_id = ?) AS imported`,
      [req.params.id, req.params.id]
    );
    if (Number(references[0].submissions) + Number(references[0].imported) > 0) {
      return res.status(409).json({ error: '该加分项已有历史材料或成绩，不能删除' });
    }
    await ScoringRule.deleteItem(req.params.id);
    await auditLog(req, 'rules.item.delete', 'scoring_item', req.params.id, null);
    res.json({ message: '已删除' });
  } catch (err) {
    sendError(res, err);
  }
};

// 锁定/解锁
exports.toggleLock = async (req, res) => {
  try {
    const current = await ScoringRule.getLockStatus();
    const newState = !current.is_locked;
    await ScoringRule.setLock(newState, req.user.userId);
    await auditLog(req, 'rules.lock.toggle', 'rules_lock', null, { locked: newState });
    res.json({ locked: newState, message: newState ? '规则已锁定' : '规则已解锁' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
