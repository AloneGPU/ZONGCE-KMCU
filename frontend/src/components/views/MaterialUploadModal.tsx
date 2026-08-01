import React, { useState } from 'react';
import { RuleCategoryConfig, User } from '../../types';
import { Info, Sparkles, Upload, X } from 'lucide-react';

interface MaterialUploadModalProps {
  currentUser: User;
  ruleConfigs: RuleCategoryConfig[];
  activeAcademicYear: string;
  onClose: () => void;
  onSubmitMaterial: (data: { moduleId: string; itemId: string; year: string; description: string; awardMonth?: string; proof?: File; count?: number; proofName?: string; onProgress?: (pct: number) => void }) => Promise<any>;
}

export const MaterialUploadModal: React.FC<MaterialUploadModalProps> = ({
  currentUser, ruleConfigs, activeAcademicYear, onClose, onSubmitMaterial
}) => {
  const [category, setCategory] = useState(ruleConfigs[0]?.category || 'ability');
  const [itemId, setItemId] = useState('');
  const [description, setDescription] = useState('无');
  const [awardMonth, setAwardMonth] = useState('');
  const [proof, setProof] = useState<File>();
  const [proofName, setProofName] = useState('');
  const [count, setCount] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const selectedCategory = ruleConfigs.find(item => item.category === category) || ruleConfigs[0];
  const selectedItem = selectedCategory?.items.find(item => item.id === itemId);
  const proofExt = proof?.name.includes('.') ? proof.name.substring(proof.name.lastIndexOf('.')) : '';
  const moduleLabel = selectedCategory?.categoryName
    ? (selectedCategory.categoryName.endsWith('类') ? selectedCategory.categoryName : `${selectedCategory.categoryName}类`)
    : '加分类';
  const previewProofName = proof && selectedItem && proofName.trim()
    ? `${currentUser.studentId || currentUser.username}_${currentUser.name}_${moduleLabel}_${(selectedItem.unitScore * count).toFixed(1).replace(/\.0$/, '')}分_${proofName.trim()}${proofExt}`
    : '';

  // Filter items by keyword across ALL modules (search)
  const allProofItems = ruleConfigs.flatMap(c => c.items.filter(i => i.requiresProof));
  const matchedItems = searchKeyword.trim()
    ? allProofItems.filter(i => i.name.includes(searchKeyword) || i.description?.includes(searchKeyword) || ruleConfigs.find(c => c.items.some(ci => ci.id === i.id))?.categoryName?.includes(searchKeyword))
    : [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedCategory || !itemId) return;
    if (!proof) return alert('请上传证明图片');
    if (proof.size > 10 * 1024 * 1024) return alert('图片超过10MB上限，请压缩后重试');
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/gif'].includes(proof.type)) return alert('仅支持 JPG、PNG、GIF 图片');
    if (!proofName.trim()) return alert('请填写学生自定义图片名称');
    setSubmitting(true);
    try {
      const desc = count > 1 ? `${description || '无'} 【×${count}次】`.trim() : (description.trim() || '无');
      setUploadProgress(0);
      await onSubmitMaterial({ moduleId: String(selectedCategory.moduleId), itemId, year: activeAcademicYear, description: desc, awardMonth, proof, count, proofName: proofName.trim(), onProgress: (pct) => setUploadProgress(pct) });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
      <div className="surface-elevated rounded-2xl w-full max-w-xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 space-y-5 my-2 sm:my-8">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div><h3 className="text-base font-bold flex items-center gap-2"><Sparkles className="w-4 h-4 text-blue-600" />新增综测材料申报</h3><p className="text-xs text-slate-500 mt-1">分值以服务器中的评分规则为准，不能在此自行填写。</p></div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4 text-xs">
          <div className="flex items-center gap-2 mb-1 text-xs text-slate-500">
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
                      return <div key={item.id} className={`px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700 flex justify-between gap-3 ${isSelected ? 'bg-blue-600 text-white font-bold' : 'text-slate-700 dark:text-slate-200'}`} onMouseDown={() => { setItemId(item.id); setSearchKeyword(''); setShowDropdown(false); }}><span><span className={isSelected ? 'text-blue-100' : 'text-slate-400'}>[{parentModule?.categoryName || ''}]</span> {item.name}</span><span className={`${isSelected ? 'text-white' : 'text-blue-600 dark:text-blue-400'} font-semibold shrink-0`}>{item.unitScore}分</span></div>;
                    })
                  ) : matchedItems.length > 0 ? (
                    matchedItems.map(item => {
                      const idx = item.name.indexOf(searchKeyword);
                      const isSelected = item.id === itemId;
                      const modCategory = ruleConfigs.find(c => c.items.some(ci => ci.id === item.id));
                      return <div key={item.id} className={`px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-slate-700 flex justify-between gap-3 ${isSelected ? 'bg-blue-600 text-white font-bold' : 'text-slate-700 dark:text-slate-200'}`} onMouseDown={() => { setItemId(item.id); setSearchKeyword(''); setShowDropdown(false); if (modCategory) setCategory(modCategory.category); }}><span><span className={isSelected ? 'text-blue-100' : 'text-slate-400'}>[{modCategory?.categoryName || ''}]</span> {idx >= 0 ? (<>{item.name.substring(0, idx)}<mark className="bg-yellow-300 dark:bg-yellow-600 text-black rounded px-0.5">{item.name.substring(idx, idx + searchKeyword.length)}</mark>{item.name.substring(idx + searchKeyword.length)}</>) : item.name}</span><span className={`${isSelected ? 'text-white' : 'text-blue-600 dark:text-blue-400'} font-semibold shrink-0`}>{item.unitScore}分</span></div>;
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
              <input type="number" min="1" max="20" value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))} className="w-14 text-center py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-sm font-bold text-blue-600 dark:text-blue-400" />
              <button type="button" onClick={() => setCount(Math.min(20, count + 1))} className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 font-bold text-lg flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-900 active:scale-95 transition-all">+</button>
            </div>
            <span className="text-xs text-slate-500 sm:ml-auto">= <strong className="text-blue-600">{((count) * (selectedItem?.unitScore || 0)).toFixed(1)} 分</strong></span>
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
              <span className="text-slate-400 font-normal">（仅支持图片，≤10MB）</span>
            </span>
            <label className={`relative mt-1 block border-2 border-dashed rounded-2xl p-5 text-center transition-colors cursor-pointer bg-slate-50/50 dark:bg-slate-800/30 ${proof && proof.size > 10*1024*1024 ? 'border-rose-400 bg-rose-50' : 'border-slate-300 dark:border-slate-700 hover:border-amber-400'}`}>
              <input required type="file" accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif" onChange={e => { const f = e.target.files?.[0]; if (f) { setProof(f); } }} className="sr-only" />
              {!proof ? (
                <>
                  <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">点击此处上传文件</p>
                  <p className="text-xs text-slate-400 mt-1">或将文件拖拽到此处</p>
                </>
              ) : (
                <div className="text-left space-y-2">
                  <p className="text-sm text-slate-700 dark:text-slate-200 font-medium truncate">{proof.name}</p>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{(proof.size / 1024 / 1024).toFixed(2)} MB / 10 MB</span>
                    <span>{proof.size > 10*1024*1024 ? '文件超限' : ((10 - proof.size/1024/1024).toFixed(1)) + ' MB 剩余'}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${proof.size > 10*1024*1024 ? 'bg-rose-500 w-full' : proof.size / 1024/1024 > 8 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: Math.min((proof.size / (10*1024*1024)) * 100, 100) + '%' }} />
                  </div>
                  {proof.size > 10*1024*1024 && <p className="text-xs text-rose-500 font-semibold">文件超过10MB上限，请压缩后重试</p>}
                  <p className="text-xs text-slate-400">点击此区域可重新选择图片</p>
                </div>
              )}
            </label>
            {proof && (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800/70">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">学生自定义图片名称</label>
                <input type="text" required value={proofName} onChange={e => setProofName(e.target.value)} placeholder="如：校运会100米获奖证书" className="mt-1 w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                {previewProofName && (
                  <p className="mt-2 text-xs text-slate-500 break-all">
                    保存后文件名：<span className="font-semibold text-blue-600 dark:text-blue-400">{previewProofName}</span>
                  </p>
                )}
              </div>
            )}
          </div>
          {submitting && (
            <div className="pt-2 space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{uploadProgress >= 100 ? '上传完成，处理中...' : '正在上传提交证明材料...'}</span>
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
              {submitting ? '提交中...' : selectedItem ? `提交 ${selectedItem.unitScore * count} 分材料` : '提交审核'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
