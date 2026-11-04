import React, { useRef, useState } from 'react';
import { ProofMaterial, RuleCategoryConfig, User } from '../../types';
import { Info, Sparkles, Upload, X } from 'lucide-react';

interface MaterialUploadModalProps {
  currentUser: User;
  ruleConfigs: RuleCategoryConfig[];
  activeAcademicYear: string;
  editingMaterial?: ProofMaterial | null;
  onClose: () => void;
  onSubmitMaterial: (data: { moduleId?: string; itemId?: string; year?: string; description: string; awardMonth?: string; proofs?: File[]; count?: number; proofName?: string; onProgress?: (pct: number) => void }) => Promise<any>;
}

export const MaterialUploadModal: React.FC<MaterialUploadModalProps> = ({
  currentUser, ruleConfigs, activeAcademicYear, editingMaterial, onClose, onSubmitMaterial
}) => {
  const isEditing = Boolean(editingMaterial);
  const initialCategory = editingMaterial?.categoryId || ruleConfigs[0]?.category || 'ability';
  const initialDescription = editingMaterial?.description || '无';
  const initialCount = Number(initialDescription.match(/【×(\d+)次】/)?.[1] || 1);
  const [category, setCategory] = useState(initialCategory);
  const [itemId, setItemId] = useState(editingMaterial?.ruleItemId || '');
  const [description, setDescription] = useState(initialDescription.replace(/\s*【×\d+次】\s*$/, '') || '无');
  const [awardMonth, setAwardMonth] = useState(editingMaterial?.awardMonth || '');
  const [proofs, setProofs] = useState<File[]>([]);
  const proofInputRef = useRef<HTMLInputElement>(null);
  const [proofName, setProofName] = useState(editingMaterial?.title || '');
  const [count, setCount] = useState(Math.min(100, Math.max(1, initialCount)));
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const selectedCategory = ruleConfigs.find(item => item.category === category) || ruleConfigs[0];
  const selectedItem = selectedCategory?.items.find(item => item.id === itemId);
  const proofExt = proofs[0]?.name.includes('.') ? proofs[0].name.substring(proofs[0].name.lastIndexOf('.')) : '';
  const totalProofSize = proofs.reduce((sum, proof) => sum + proof.size, 0);
  const moduleLabel = selectedCategory?.categoryName
    ? (selectedCategory.categoryName.endsWith('类') ? selectedCategory.categoryName : `${selectedCategory.categoryName}类`)
    : '加分类';
  const previewProofName = proofs.length > 0 && selectedItem && proofName.trim()
    ? `${currentUser.studentId || currentUser.username}_${currentUser.name}_${moduleLabel}_${String(selectedItem.unitScore * count)}分_${proofName.trim()}${proofExt}`
    : '';

  const addProofs = (selectedFiles: FileList | null) => {
    const incoming = Array.from(selectedFiles || []);
    if (proofInputRef.current) proofInputRef.current.value = '';
    if (incoming.length === 0) return;
    if (incoming.some(file => !['image/jpeg', 'image/jpg', 'image/png', 'image/gif'].includes(file.type))) {
      alert('仅支持 JPG、PNG、GIF 图片');
      return;
    }
    const existingKeys = new Set(proofs.map(file => `${file.name}-${file.size}-${file.lastModified}`));
    const next = [...proofs, ...incoming.filter(file => !existingKeys.has(`${file.name}-${file.size}-${file.lastModified}`))];
    if (next.length > 10) {
      alert('一次最多选择 10 张图片');
      return;
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > 10 * 1024 * 1024) {
      alert('所有图片总大小不能超过 10MB，请压缩或移除部分图片后重试');
      return;
    }
    setProofs(next);
  };

  const removeProof = (index: number) => setProofs(prev => prev.filter((_, itemIndex) => itemIndex !== index));
  const clearProofs = () => {
    setProofs([]);
    if (proofInputRef.current) proofInputRef.current.value = '';
  };

  // Filter items by keyword across ALL modules (search)
  const allProofItems = ruleConfigs.flatMap(c => c.items.filter(i => i.requiresProof));
  const matchedItems = searchKeyword.trim()
    ? allProofItems.filter(i => i.name.includes(searchKeyword) || i.description?.includes(searchKeyword) || ruleConfigs.find(c => c.items.some(ci => ci.id === i.id))?.categoryName?.includes(searchKeyword))
    : [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isEditing && (!selectedCategory || !itemId)) return;
    if (!isEditing && proofs.length === 0) return alert('请上传至少一张证明图片');
    if (totalProofSize > 10 * 1024 * 1024) return alert('所有图片总大小不能超过 10MB');
    if (proofs.length > 0 && !proofName.trim()) return alert('请填写学生自定义图片名称');
    setSubmitting(true);
    try {
      const desc = count > 1 ? `${description || '无'} 【×${count}次】`.trim() : (description.trim() || '无');
      setUploadProgress(0);
      await onSubmitMaterial({
        moduleId: String(selectedCategory.moduleId),
        itemId,
        year: isEditing ? undefined : activeAcademicYear,
        description: desc,
        awardMonth,
        proofs,
        count,
        proofName: proofName.trim(),
        onProgress: (pct) => setUploadProgress(pct)
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
      <div className="surface-elevated rounded-2xl w-full max-w-xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 space-y-5 my-2 sm:my-8">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="min-w-0"><h3 className="flex min-w-0 items-center gap-2 text-base font-bold"><Sparkles className="w-4 h-4 text-blue-600" /><span className="min-w-0">{isEditing ? '修改被退回的材料' : '新增综测材料申报'}</span></h3><p className="text-xs text-slate-500 mt-1">{isEditing ? '修改说明或重新上传证明后，会重新进入审核流程。' : '分值以服务器中的评分规则为准，不能在此自行填写。'}</p></div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 text-xs">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold text-slate-700 dark:text-slate-300">当前学年：{activeAcademicYear}</span>
            <span className="text-slate-400">（由管理员/辅导员统一设置）</span>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <label>评分模块<select value={category} onChange={e => { setCategory(e.target.value); setItemId(''); }} className="mt-1 w-full px-3 py-2 rounded-xl border">{ruleConfigs.map(config => <option key={config.category} value={config.category}>{config.categoryName}</option>)}</select></label>
          </div>
          <label className="block">加分项目
            <div className="relative">
              <input type="text" value={searchKeyword} onChange={e => { setSearchKeyword(e.target.value); setShowDropdown(true); }} onFocus={() => setShowDropdown(true)} onBlur={() => setTimeout(() => setShowDropdown(false), 200)} placeholder={itemId && selectedItem ? `${selectedItem.name}（固定 ${selectedItem.unitScore} 分）` : '🔍 输入关键字搜索加分项...'} className="mt-1 w-full px-3 py-2 rounded-xl border" />
              {showDropdown && (
                <div className="absolute z-20 w-full mt-1 max-h-60 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg text-xs">
                  {matchedItems.length === 0 && !searchKeyword.trim() ? (
                    selectedCategory?.items.filter(item => item.requiresProof).map(item => {
                      const isSelected = item.id === itemId;
                      const parentModule = ruleConfigs.find(c => c.items.some(ci => ci.id === item.id));
                      return <div key={item.id} className={`flex cursor-pointer justify-between gap-3 px-3 py-2 hover:bg-blue-50 dark:hover:bg-slate-700 ${isSelected ? 'bg-blue-600 text-white font-bold' : 'text-slate-700 dark:text-slate-200'}`} onMouseDown={() => { setItemId(item.id); setSearchKeyword(''); setShowDropdown(false); }}><span className="min-w-0 break-words"><span className={isSelected ? 'text-blue-100' : 'text-slate-400'}>[{parentModule?.categoryName || ''}]</span> {item.name}</span><span className={`${isSelected ? 'text-white' : 'text-blue-600 dark:text-blue-400'} font-semibold shrink-0`}>{item.unitScore}分</span></div>;
                    })
                  ) : matchedItems.length > 0 ? (
                    matchedItems.map(item => {
                      const idx = item.name.indexOf(searchKeyword);
                      const isSelected = item.id === itemId;
                      const modCategory = ruleConfigs.find(c => c.items.some(ci => ci.id === item.id));
                      return <div key={item.id} className={`flex cursor-pointer justify-between gap-3 px-3 py-2 hover:bg-blue-50 dark:hover:bg-slate-700 ${isSelected ? 'bg-blue-600 text-white font-bold' : 'text-slate-700 dark:text-slate-200'}`} onMouseDown={() => { setItemId(item.id); setSearchKeyword(''); setShowDropdown(false); if (modCategory) setCategory(modCategory.category); }}><span className="min-w-0 break-words"><span className={isSelected ? 'text-blue-100' : 'text-slate-400'}>[{modCategory?.categoryName || ''}]</span> {idx >= 0 ? (<>{item.name.substring(0, idx)}<mark className="bg-yellow-300 dark:bg-yellow-600 text-black rounded px-0.5">{item.name.substring(idx, idx + searchKeyword.length)}</mark>{item.name.substring(idx + searchKeyword.length)}</>) : item.name}</span><span className={`${isSelected ? 'text-white' : 'text-blue-600 dark:text-blue-400'} font-semibold shrink-0`}>{item.unitScore}分</span></div>;
                    })
                  ) : (
                    <div className="px-3 py-4 text-center text-slate-400">未找到匹配的加分项，试试其他关键词</div>
                  )}
                </div>
              )}
            </div>
          </label>
          {selectedItem && <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 p-3 text-blue-800 dark:text-blue-200 flex gap-2"><Info className="w-4 h-4 shrink-0" /><span>{selectedItem.evidence || selectedItem.description || '请按要求提供有效证明材料。'}</span></div>}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 shrink-0">提交次数</span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setCount(Math.max(1, count - 1))} className="w-9 h-9 rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold text-lg flex items-center justify-center hover:bg-slate-50 dark:hover:bg-slate-600 active:scale-95 transition-all">−</button>
              <input type="number" min="1" max="100" value={count} onChange={e => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))} className="w-14 text-center py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-bold text-blue-600 dark:text-blue-400" />
              <button type="button" onClick={() => setCount(Math.min(100, count + 1))} className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 font-bold text-lg flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-900 active:scale-95 transition-all">+</button>
            </div>
            <span className="text-xs text-slate-500 sm:ml-auto">= <strong className="text-blue-600">{(count) * (selectedItem?.unitScore || 0)} 分</strong></span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">奖项获得时间
              <input type="month" value={awardMonth} onChange={e => setAwardMonth(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border bg-white dark:bg-slate-800" />
            </label>
            <label className="block">申请理由 / 补充说明
              <input value={description} onChange={e => setDescription(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-xl border bg-white dark:bg-slate-800" placeholder="无" />
            </label>
          </div>
          <div className="block">
            <span className="flex items-center gap-2 mb-2">
              <Upload className="w-4 h-4 text-amber-500" />
              <span className="font-semibold">证明材料</span>
              <span className="text-slate-400 font-normal">（最多 10 张，合计≤10MB{isEditing ? '；不选则保留原证明' : ''}）</span>
            </span>
            <label className="relative mt-1 block cursor-pointer rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-5 text-center transition-colors hover:border-amber-400 dark:border-slate-700 dark:bg-slate-800/30">
              <input ref={proofInputRef} type="file" multiple accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif" onChange={e => addProofs(e.target.files)} className="sr-only" />
              {proofs.length === 0 ? (
                <>
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">点击此处选择证明图片</p>
                  <p className="text-xs text-slate-400 mt-1">{isEditing ? '不选择新图片则保留原证明材料' : '可分多次追加，最多 10 张'}</p>
                </>
              ) : (
                <div className="text-left space-y-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200">已选择 {proofs.length} 张图片，点击可继续追加</p>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="shrink-0">{(totalProofSize / 1024 / 1024).toFixed(2)} MB / 10 MB</span>
                    <span className="min-w-0 truncate">{((10 - totalProofSize / 1024 / 1024).toFixed(1))} MB 剩余</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${totalProofSize / 1024 / 1024 > 8 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: Math.min((totalProofSize / (10 * 1024 * 1024)) * 100, 100) + '%' }} />
                  </div>
                </div>
              )}
            </label>
            {proofs.length > 0 && (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">已选图片</span>
                  <button type="button" onClick={clearProofs} className="text-xs font-semibold text-rose-600 hover:text-rose-700">取消全部</button>
                </div>
                <div className="space-y-1.5">
                  {proofs.map((proof, index) => (
                    <div key={`${proof.name}-${proof.size}-${proof.lastModified}`} className="flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-2 py-2 dark:bg-slate-900">
                      <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{index + 1}. {proof.name}</span>
                      <span className="shrink-0 text-[10px] text-slate-400">{(proof.size / 1024 / 1024).toFixed(2)}MB</span>
                      <button type="button" onClick={() => removeProof(index)} className="shrink-0 rounded p-1 text-rose-500 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/50" title="移除此图片"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">学生自定义图片名称</label>
                <input type="text" required value={proofName} onChange={e => setProofName(e.target.value)} placeholder="如：校运会100米获奖证书" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                {previewProofName && (
                  <p className="mt-2 text-xs text-slate-500 break-all">
                    保存后首张文件名：<span className="font-semibold text-blue-600 dark:text-blue-400">{previewProofName}</span>
                  </p>
                )}
              </div>
            )}
          </div>
          {submitting && (
            <div className="pt-2 space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span className="min-w-0">{uploadProgress >= 100 ? '上传完成，处理中...' : '正在上传提交证明材料...'}</span>
                <span className="font-mono font-semibold text-amber-600">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 rounded-full transition-all duration-300" style={{ width: uploadProgress + '%' }} />
              </div>
            </div>
          )}
          <div className="pt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onClick={onClose} disabled={submitting} className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">取消</button>
            <button type="submit" disabled={submitting || !itemId} className={`w-full sm:w-auto justify-center px-6 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all shadow-lg ${submitting || !itemId ? 'bg-slate-300 dark:bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-600 active:scale-95 text-white shadow-amber-500/30'}`}>
              <Upload className="w-4 h-4" />
              <span>{submitting ? '提交中...' : isEditing ? '修改并重新提交审核' : selectedItem ? `提交 ${selectedItem.unitScore * count} 分材料` : '提交审核'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
