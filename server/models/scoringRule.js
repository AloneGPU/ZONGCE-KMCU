const pool = require('../config/database');

const ScoringRule = {
  async getModules() {
    const [rows] = await pool.query('SELECT * FROM scoring_modules ORDER BY sort_order');
    return rows;
  },

  async getModuleById(id) {
    const [rows] = await pool.query('SELECT * FROM scoring_modules WHERE id = ?', [id]);
    return rows[0] || null;
  },

  async getItems(moduleId) {
    const [rows] = await pool.query('SELECT * FROM scoring_items WHERE module_id = ? ORDER BY sort_order', [moduleId]);
    return rows;
  },

  async getAllItems() {
    const [rows] = await pool.query(
      `SELECT si.*, sm.name as module_name, sm.weight as module_weight
       FROM scoring_items si JOIN scoring_modules sm ON si.module_id = sm.id
       ORDER BY sm.sort_order, si.sort_order`
    );
    return rows;
  },

  async getFullRules() {
    const modules = await this.getModules();
    const items = await this.getAllItems();
    const lock = await this.getLockStatus();
    return {
      modules: modules.map(m => ({
        ...m,
        items: items.filter(i => i.module_id === m.id),
      })),
      locked: lock.is_locked,
    };
  },

  async createModule({ name, weight, sortOrder }) {
    const [result] = await pool.query(
      'INSERT INTO scoring_modules (name, weight, sort_order) VALUES (?, ?, ?)',
      [name, weight, sortOrder || 0]
    );
    return { id: result.insertId, name, weight, sort_order: sortOrder || 0 };
  },

  async updateModule(id, data) {
    const fields = [];
    const values = [];
    const allowed = new Set(['name', 'weight', 'sort_order']);
    for (const [k, v] of Object.entries(data)) {
      if (!allowed.has(k)) continue;
      fields.push(`\`${k}\` = ?`);
      values.push(v);
    }
    if (fields.length === 0) return false;
    values.push(id);
    const [result] = await pool.query(`UPDATE scoring_modules SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.affectedRows > 0;
  },

  async deleteModule(id) {
    await pool.query('DELETE FROM scoring_modules WHERE id = ?', [id]);
  },

  async createItem({ moduleId, name, maxScore, description, requiresProof, evidence, sortOrder }) {
    const [result] = await pool.query(
      `INSERT INTO scoring_items (module_id, name, max_score, description, evidence, requires_proof, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [moduleId, name, maxScore, description, evidence || '', requiresProof !== false, sortOrder || 0]
    );
    return { id: result.insertId, module_id: moduleId, name, max_score: maxScore, description, evidence: evidence || '', requires_proof: requiresProof !== false };
  },

  async updateItem(id, { moduleId, name, maxScore, description, requiresProof, evidence, sortOrder }) {
    const fields = [];
    const values = [];
    const add = (column, value) => {
      if (value !== undefined) {
        fields.push(`\`${column}\` = ?`);
        values.push(value);
      }
    };

    add('module_id', moduleId);
    add('name', name);
    add('max_score', maxScore);
    add('description', description);
    add('evidence', evidence);
    if (requiresProof !== undefined) add('requires_proof', requiresProof !== false);
    add('sort_order', sortOrder);

    if (fields.length === 0) return null;
    values.push(id);
    const [result] = await pool.query(`UPDATE scoring_items SET ${fields.join(', ')} WHERE id = ?`, values);
    return result.affectedRows > 0;
  },

  async deleteItem(id) {
    await pool.query('DELETE FROM scoring_items WHERE id = ?', [id]);
  },

  async getLockStatus() {
    const [rows] = await pool.query('SELECT * FROM rules_lock ORDER BY id LIMIT 1');
    return rows[0] || { is_locked: false };
  },

  async setLock(isLocked, userId) {
    await pool.query('DELETE FROM rules_lock');
    await pool.query(
      'INSERT INTO rules_lock (is_locked, locked_by, locked_at) VALUES (?, ?, NOW())',
      [isLocked, userId]
    );
  },
};

module.exports = ScoringRule;
