import React, { useState } from 'react';
import { RuleCategoryConfig, BonusRuleItem, User } from '../../types';
import { Lock, LockOpen, Plus, Trash2, Edit2, ShieldAlert, Sparkles, Search, Layers, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiService } from '../../services/api';

interface RuleManagementProps {
  ruleConfigs: RuleCategoryConfig[];
  rulesLocked: boolean;
  onUpdateRuleConfigs: (configs: RuleCategoryConfig[]) => void;
  onToggleLockRules: (locked: boolean) => void;
  isAdmin: boolean;
  currentUser?: User;
}

export const RuleManagement: React.FC<RuleManagementProps> = ({
  ruleConfigs,
  rulesLocked,
  onUpdateRuleConfigs,
  onToggleLockRules,
  isAdmin,
  currentUser
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('moral');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<BonusRuleItem | null>(null);
  const [newItemMode, setNewItemMode] = useState<'bonus' | 'deduction'>('bonus');

  const [newItem, setNewItem] = useState<Partial<BonusRuleItem>>({
    name: '',
    description: '',
    maxScore: 10,
    unitScore: 5,
    requiresProof: true,
    scoreType: 'tiered'
  });

  const activeCategoryConfig = ruleConfigs.find(r => r.category === selectedCategory) || ruleConfigs[0];
  const canManageAllRules = isAdmin && currentUser?.role === 'admin';
  const canManageMoralDeductions =
    (currentUser?.role === 'admin' || currentUser?.role === 'counselor') && activeCategoryConfig?.category === 'moral';
  const canManageActiveCategory = !rulesLocked && (canManageAllRules || canManageMoralDeductions);
  const isMoralDeductionItem = (item: BonusRuleItem) =>
    activeCategoryConfig?.category === 'moral' && !item.requiresProof && Number(item.maxScore) < 0;
  const canManageItem = (item: BonusRuleItem) =>
    !rulesLocked && (canManageAllRules || (currentUser?.role === 'counselor' && isMoralDeductionItem(item)));
  const isMoralCategory = activeCategoryConfig?.category === 'moral';
  const isDeductionAddMode = isMoralCategory && newItemMode === 'deduction';
  const scoreLabel = isDeductionAddMode ? '每次扣分值' : '最高封顶得分';
  const scorePrefix = isDeductionAddMode ? '-' : '+';
  const displayScore = (score: number) => Math.abs(Number(score) || 0);
  const isEditCounselorDeduction = editingItem ? isMoralDeductionItem(editingItem) : false;
  const editScoreLabel = isEditCounselorDeduction ? '每次扣分值' : '最高封顶得分';

  const openAddRuleModal = () => {
    setEditingItem(null);
    const deduction = isMoralCategory;
    setNewItemMode(deduction ? 'deduction' : 'bonus');
    if (deduction) {
      setNewItem({ name: '', description: '', maxScore: 5, unitScore: 5, requiresProof: false, scoreType: 'fixed', evidence: '德育扣分批量导入' });
    } else {
      setNewItem({ name: '', description: '', maxScore: 10, unitScore: 5, requiresProof: true, scoreType: 'tiered' });
    }
    setShowAddItemModal(true);
  };

  const openEditRuleModal = (item: BonusRuleItem) => {
    if (!canManageItem(item)) return;
    setShowAddItemModal(false);
    setEditingItem(isMoralDeductionItem(item) ? { ...item, maxScore: displayScore(item.maxScore), unitScore: displayScore(item.unitScore) } : item);
  };

  const filteredItems = activeCategoryConfig.items.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
  });

  const handleWeightChange = async (category: string, newWeight: number) => {
    if (!canManageAllRules || rulesLocked) return;
    const cfg = ruleConfigs.find(c => c.category === category);
    if (!cfg) return;
    const weightPercent = Math.round(newWeight * 100);
    if (weightPercent < 0 || weightPercent > 100) return;
    try {
      await apiService.updateScoringModule(cfg.moduleId, weightPercent);
      onUpdateRuleConfigs(ruleConfigs);
    } catch (e: any) {
      alert('权重更新失败: ' + (e?.message || '请重试'));
    }
  };

  const handleAddItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItem.name || !canManageActiveCategory) { alert('仅管理员或辅导员可维护当前规则'); return; }

    try {
      const counselorDeduction = isDeductionAddMode;
      await apiService.createScoringItem({
        moduleId: activeCategoryConfig.moduleId,
        name: newItem.name || (counselorDeduction ? '新扣分项' : '新加分项'),
        maxScore: counselorDeduction ? -displayScore(Number(newItem.maxScore) || 5) : Number(newItem.maxScore) || 5,
        description: newItem.description || '',
        requiresProof: counselorDeduction ? false : newItem.requiresProof ?? true,
        evidence: counselorDeduction ? '德育扣分批量导入' : newItem.evidence || '请提供相关证明',
      }, currentUser?.role || 'admin');
      // 重新从服务端加载规则
      onUpdateRuleConfigs(ruleConfigs);
    } catch(e: any) { alert('添加失败: ' + (e.message || '请重试')); return; }

    setShowAddItemModal(false);
    setNewItem({ name: '', description: '', maxScore: 10, unitScore: 5, requiresProof: true, scoreType: 'tiered' });
  };

  const handleEditItemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !editingItem.name) return;
    if (!canManageItem(editingItem)) { alert('无权编辑该规则项'); return; }

    try {
      const counselorDeduction = isEditCounselorDeduction;
      await apiService.updateScoringItem(Number(editingItem.id), {
        name: editingItem.name,
        maxScore: counselorDeduction ? -displayScore(Number(editingItem.maxScore) || 0) : Number(editingItem.maxScore) || 0,
        description: editingItem.description || '',
        requiresProof: counselorDeduction ? false : editingItem.requiresProof,
        evidence: counselorDeduction ? '德育扣分批量导入' : editingItem.evidence || '请提供相关证明',
      }, currentUser?.role || 'admin');
      setEditingItem(null);
      onUpdateRuleConfigs(ruleConfigs);
    } catch (error: any) {
      alert('保存失败: ' + (error.message || '请重试'));
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const target = activeCategoryConfig.items.find(item => item.id === itemId);
    if (!target || !canManageItem(target)) return;
    if (!confirm(isMoralDeductionItem(target) ? '确定删除此德育扣分项？已有导入记录时后端会拒绝删除。' : '确定删除此加分项？已有学生提交将失去关联。')) return;
    try {
      await apiService.deleteScoringItem(Number(itemId), currentUser?.role || 'admin');
      onUpdateRuleConfigs(ruleConfigs);
    } catch(e: any) { alert('删除失败: ' + (e.message || '请重试')); }
  };

  const maxItemScore = activeCategoryConfig.items.reduce((max, item) => Math.max(max, Number(item.maxScore) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Top Banner & Locking Control */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="flex min-w-0 items-start gap-2 text-lg font-bold text-slate-900 dark:text-white sm:items-center">
                <Sparkles className="w-5 h-5 text-blue-600" />
                <span className="min-w-0">综合素质测评 (综测) 加分项细则库与规则配置引擎</span>
              </h2>
              {rulesLocked ? (
                <span className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-400">
                  <Lock className="w-3.5 h-3.5" />
                  <span>规则已锁定</span>
                </span>
              ) : (
                <span className="inline-flex max-w-full items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <LockOpen className="w-3.5 h-3.5" />
                  <span className="min-w-0">规则库当前未锁定（管理员可维护）</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              管理员可维护全部规则，并可与辅导员一样在德育板块维护扣分项；扣分导入模板会自动跟随当前扣分项变化。
            </p>
          </div>

          {isAdmin && currentUser?.role === 'admin' && (
            <button
              onClick={() => onToggleLockRules(!rulesLocked)}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold shadow-sm transition-all md:w-auto ${
                rulesLocked
                  ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20'
                  : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/20'
              }`}
            >
              {rulesLocked ? (
                <>
                  <LockOpen className="w-4 h-4" />
                  <span>解锁加分规则库</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4" />
                  <span>确认并锁定规则库</span>
                </>
              )}
            </button>
          )}
        </div>

        {rulesLocked && (
          <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              提示：当前规则库已被超级管理员锁定。任何增删改操作已暂停，学生端申报将严格依照当前规则库执行。
            </span>
          </div>
        )}
      </div>

      {/* Category Tabs & Rule Item CRUD Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Side: Category Selection & Weights */}
        <div className="lg:col-span-4 space-y-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
            综测评分维度分类与上限
          </div>

          <div className="space-y-2">
            {ruleConfigs.map(cfg => {
              const isSelected = cfg.category === selectedCategory;
              return (
                <div
                  key={cfg.category}
                  onClick={() => setSelectedCategory(cfg.category)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                      : 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-md text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sm">{cfg.categoryName}</span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                      isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}>
                      {cfg.items.length} 个可选细则
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs opacity-90 mt-2 pt-2 border-t border-current/10">
                    <div>
                      <span className="text-[10px] opacity-75 block">综合分占比权重</span>
                      <span className="font-semibold">{(cfg.baseWeight * 100).toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-[10px] opacity-75 block">本类单项最高加分</span>
                      <span className="font-semibold">+{cfg.items.reduce((max, it) => Math.max(max, Number(it.maxScore) || 0), 0)} 分</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Selected Category Rule Items CRUD */}
        <div className="lg:col-span-8 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <span>{activeCategoryConfig.categoryName} 可选规则细则清单</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isMoralCategory
                  ? '管理员和辅导员均可维护德育扣分项；下载德育扣分模板时会自动使用当前列表。'
                  : `得分逻辑：学生可在前端选择以下加分项并提交对应佐证，审核通过后按各细则分值计入（本类单项最高 +${maxItemScore} 分）。`}
              </p>
            </div>

            {canManageActiveCategory && (
              <button
                onClick={openAddRuleModal}
                className={`px-3.5 py-2 text-white text-xs font-semibold rounded-xl flex items-center space-x-1 shadow-sm transition-all cursor-pointer shrink-0 ${isMoralCategory ? 'bg-rose-600 hover:bg-rose-700' : 'bg-blue-600 hover:bg-blue-700'}`}
              >
                <Plus className="w-4 h-4" />
                <span>{isMoralCategory ? '新增德育规则项' : '新增加分项'}</span>
              </button>
            )}
          </div>

          {/* Search & Toolbar */}
          <div className="flex flex-col gap-3 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="搜索当前分类下的规则项名称或细则描述..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            <div className="shrink-0 text-slate-400 text-[11px]">
              共 <span className="text-blue-600 font-bold">{filteredItems.length}</span> 项细则
            </div>
          </div>

          {/* Quick Edit Weight for Admin/Counselor */}
          {canManageAllRules && !rulesLocked && (
            <div className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 rounded-xl grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border border-slate-200/60 dark:border-slate-800">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  板块综合占比权重 (0 - 1.0，六大板块合计须为 1.0)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={activeCategoryConfig.baseWeight}
                  onChange={e => handleWeightChange(activeCategoryConfig.category, parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                />
              </div>
              <div className="flex items-end">
                <div className="w-full px-3 py-1.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400">
                  本类单项最高可加 <span className="font-bold text-slate-800 dark:text-slate-200">+{maxItemScore} 分</span>
                </div>
              </div>
            </div>
          )}

          {/* Rules Item Cards List */}
          <div className="space-y-3">
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                未匹配到规则细则，请点击右上角按钮进行配置。
              </div>
            ) : (
              filteredItems.map(item => (
                <div
                  key={item.id}
                  className="p-4 bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-2xl space-y-2 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h4 className="flex min-w-0 flex-wrap items-center gap-2 font-bold text-xs text-slate-900 dark:text-white">
                        <span className="min-w-0 break-words">{item.name}</span>
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md border ${isMoralDeductionItem(item) ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300' : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300'}`}>
                          {isMoralDeductionItem(item) ? '德育扣分项' : item.scoreType === 'tiered' ? '阶梯级别加分' : item.scoreType === 'input' ? '人工自由填报' : '固定加分'}
                        </span>
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                        {item.description}
                      </p>
                    </div>

                    <div className="shrink-0 text-left sm:ml-4 sm:text-right">
                      <div className={`text-sm font-bold ${isMoralDeductionItem(item) ? 'text-rose-600 dark:text-rose-400' : 'text-blue-600 dark:text-blue-400'}`}>
                        {isMoralDeductionItem(item) ? `每次 -${displayScore(item.maxScore)} 分` : `最高 +${item.maxScore} 分`}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {isMoralDeductionItem(item) ? '用于德育扣分批量导入模板' : `建议标准: +${item.unitScore} 分`}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-slate-200/60 pt-2 text-[11px] text-slate-400 dark:border-slate-800/80 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex min-w-0 items-start gap-1 sm:items-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="min-w-0">{item.requiresProof ? '必须提交证书/材料影印件' : isMoralDeductionItem(item) ? '免提交材料，可批量导入扣分' : '免提交材料，自动关联考核记录'}</span>
                    </span>

                    {canManageItem(item) && (
                      <div className="flex shrink-0 items-center gap-3">
                        <button
                          onClick={() => openEditRuleModal(item)}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>编辑</span>
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="flex items-center gap-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>删除</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Add New Rule Item Modal */}
      {showAddItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
          <div className="surface-elevated rounded-2xl w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 space-y-4 my-2 sm:my-8">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              新增 【{activeCategoryConfig.categoryName}】 {isDeductionAddMode ? '扣分规则项' : '加分规则项'}
            </h3>

            <form onSubmit={handleAddItemSubmit} className="space-y-3.5 text-xs">
              {currentUser?.role === 'admin' && isMoralCategory && (
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">新增规则类型</label>
                  <select
                    value={newItemMode}
                    onChange={e => {
                      const mode = e.target.value as 'bonus' | 'deduction';
                      setNewItemMode(mode);
                      setNewItem(mode === 'deduction'
                        ? { name: '', description: '', maxScore: 5, unitScore: 5, requiresProof: false, scoreType: 'fixed', evidence: '德育扣分批量导入' }
                        : { name: '', description: '', maxScore: 10, unitScore: 5, requiresProof: true, scoreType: 'tiered' });
                    }}
                    className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  >
                    <option value="deduction">德育扣分项（批量导入）</option>
                    <option value="bonus">德育加分项（学生申报）</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  {isDeductionAddMode ? '扣分项名称' : '加分项名称'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={isDeductionAddMode ? '例如: 通报批评 / 宿舍卫生不合格 / 班团活动缺勤' : '例如: 全国大学生算法竞赛省级一等奖 / 志愿服务工时累计'}
                  value={newItem.name}
                  onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  {isDeductionAddMode ? '扣分说明与统计口径' : '细则描述与各级别加分评判标准'}
                </label>
                <textarea
                  rows={3}
                  placeholder={isDeductionAddMode ? '例如：每缺勤 1 次扣 2 分；宿舍检查每次不合格扣 3 分。' : '例如：国家级一等奖+30分，省级一等奖+18分，校级一等奖+10分；队长全额计分，队员按80%计分...'}
                  value={newItem.description}
                  onChange={e => setNewItem({ ...newItem, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl leading-relaxed"
                />
              </div>

              <div className={`grid grid-cols-1 gap-3 ${isDeductionAddMode ? 'sm:grid-cols-1' : 'sm:grid-cols-3'}`}>
                {!isDeductionAddMode && <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    评分判定类型
                  </label>
                  <select
                    value={newItem.scoreType}
                    onChange={e => setNewItem({ ...newItem, scoreType: e.target.value as any })}
                    className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  >
                    <option value="tiered">阶梯级别加分</option>
                    <option value="fixed">固定单项加分</option>
                    <option value="input">人工自由填报</option>
                  </select>
                </div>}

                {!isDeductionAddMode && <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    建议标准分值
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={newItem.unitScore}
                    onChange={e => setNewItem({ ...newItem, unitScore: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>}

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    {scoreLabel}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={newItem.maxScore}
                    onChange={e => setNewItem({ ...newItem, maxScore: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                  {isDeductionAddMode && <p className="mt-1 text-[11px] text-slate-400">请输入正数，系统保存为 {scorePrefix}{displayScore(Number(newItem.maxScore) || 0)} 分。</p>}
                </div>
              </div>

              {!isDeductionAddMode && <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="requiresProofNew"
                  checked={newItem.requiresProof ?? true}
                  onChange={e => setNewItem({ ...newItem, requiresProof: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="requiresProofNew" className="text-slate-700 dark:text-slate-300 font-medium">
                  要求学生提交证书/材料文件附件影印件
                </label>
              </div>}

              {!isDeductionAddMode && <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  学生需提交的佐证材料
                </label>
                <input
                  type="text"
                  value={newItem.evidence || ''}
                  onChange={e => setNewItem({ ...newItem, evidence: e.target.value })}
                  placeholder="例如：获奖证书照片、活动证明截图"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>}

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-xl cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md shadow-blue-600/20 cursor-pointer"
                >
                  保存{isDeductionAddMode ? '扣分' : '加分'}规则项
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Existing Rule Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
          <div className="surface-elevated rounded-2xl w-full max-w-lg max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 space-y-4 my-2 sm:my-8">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              修改{isEditCounselorDeduction ? '扣分' : '加分'}细则规则项
            </h3>

            <form onSubmit={handleEditItemSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  {isEditCounselorDeduction ? '扣分项名称' : '加分项名称'}
                </label>
                <input
                  type="text"
                  required
                  value={editingItem.name}
                  onChange={e => setEditingItem({ ...editingItem, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  {isEditCounselorDeduction ? '扣分说明与统计口径' : '细则描述与各级别加分评判标准'}
                </label>
                <textarea
                  rows={3}
                  value={editingItem.description}
                  onChange={e => setEditingItem({ ...editingItem, description: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl leading-relaxed"
                />
              </div>

              <div className={`grid grid-cols-1 gap-3 ${isEditCounselorDeduction ? 'sm:grid-cols-1' : 'sm:grid-cols-3'}`}>
                {!isEditCounselorDeduction && <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    评分判定类型
                  </label>
                  <select
                    value={editingItem.scoreType}
                    onChange={e => setEditingItem({ ...editingItem, scoreType: e.target.value as any })}
                    className="w-full px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  >
                    <option value="tiered">阶梯级别加分</option>
                    <option value="fixed">固定单项加分</option>
                    <option value="input">人工自由填报</option>
                  </select>
                </div>}

                {!isEditCounselorDeduction && <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    建议标准分值
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={editingItem.unitScore}
                    onChange={e => setEditingItem({ ...editingItem, unitScore: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>}

                <div>
                  <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                    {editScoreLabel}
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={isEditCounselorDeduction ? '0.5' : undefined}
                    value={editingItem.maxScore}
                    onChange={e => setEditingItem({ ...editingItem, maxScore: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                  {isEditCounselorDeduction && <p className="mt-1 text-[11px] text-slate-400">请输入正数，系统保存为 -{displayScore(Number(editingItem.maxScore) || 0)} 分。</p>}
                </div>
              </div>

              {!isEditCounselorDeduction && <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="requiresProofEdit"
                  checked={editingItem.requiresProof}
                  onChange={e => setEditingItem({ ...editingItem, requiresProof: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="requiresProofEdit" className="text-slate-700 dark:text-slate-300 font-medium">
                  要求学生提交证书/材料文件附件影印件
                </label>
              </div>}

              {!isEditCounselorDeduction && <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  学生需提交的佐证材料
                </label>
                <input
                  type="text"
                  value={editingItem.evidence || ''}
                  onChange={e => setEditingItem({ ...editingItem, evidence: e.target.value })}
                  placeholder="例如：获奖证书照片、活动证明截图"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>}

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-xl cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md shadow-blue-600/20 cursor-pointer"
                >
                  保存更新
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
