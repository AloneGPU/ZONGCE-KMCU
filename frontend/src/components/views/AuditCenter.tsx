import React, { useState } from 'react';
import { ProofMaterial, User } from '../../types';
import { FileCheck2, CheckCircle2, XCircle, Clock, Search, Filter, Eye, AlertCircle, Sparkles, MessageSquare, Download, FileSpreadsheet } from 'lucide-react';
import confetti from 'canvas-confetti';
import { exportMaterialAuditRecordsExcel } from '../../utils/excel';

interface AuditCenterProps {
  materials: ProofMaterial[];
  currentUser: User;
  onUpdateMaterialStatus: (
    materialId: string,
    status: 'approved' | 'rejected',
    approvedScore?: number,
    rejectReason?: string
  ) => void;
}

export const AuditCenter: React.FC<AuditCenterProps> = ({
  materials,
  currentUser,
  onUpdateMaterialStatus
}) => {
  const [selectedStatus, setSelectedStatus] = useState<string>('pending');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeMaterial, setActiveMaterial] = useState<ProofMaterial | null>(null);

  // Review Modal State
  const [reviewScore, setReviewScore] = useState<number>(0);
  const [rejectReason, setRejectReason] = useState<string>('');

  const openReviewModal = (mat: ProofMaterial) => {
    setActiveMaterial(mat);
    setReviewScore(mat.approvedScore ?? mat.requestedScore);
    setRejectReason(mat.rejectReason || '');
  };

  const handleApprove = () => {
    if (!activeMaterial) return;

    onUpdateMaterialStatus(activeMaterial.id, 'approved', reviewScore);

    // Fire celebratory confetti for positive review
    try {
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.7 }
      });
    } catch (e) {}

    setActiveMaterial(null);
  };

  const handleReject = () => {
    if (!activeMaterial) return;
    if (!rejectReason.trim()) {
      alert('请填写退回/未通过的原因，便于学生重新补充正确证明材料。');
      return;
    }

    onUpdateMaterialStatus(activeMaterial.id, 'rejected', 0, rejectReason);
    setActiveMaterial(null);
  };

  const filteredMaterials = materials.filter(m => {
    // 待审核：管理员看全院流转中材料；辅导员看所管班级待终审/可直审材料；班委看本班待初审材料。
    const isAdmin = currentUser?.role === 'admin';
    const isCounselor = currentUser?.role === 'counselor' || currentUser?.role === 'admin';
    const matchesStatus = selectedStatus === 'all'
      || (selectedStatus === 'pending' && (
        isAdmin
          ? (m.status === 'pending' || m.status === 'assistant_approved')
          : isCounselor
          ? (m.status === 'pending' || m.status === 'assistant_approved')
          : (m.status === 'pending' || m.status === 'assistant_approved')
      ))
      || m.status === selectedStatus;
    const matchesCategory = selectedCategory === 'all' || m.categoryId === selectedCategory;
    const matchesSearch =
      m.studentName.includes(searchQuery) ||
      m.studentId.includes(searchQuery) ||
      m.title.includes(searchQuery) ||
      m.majorClass.includes(searchQuery);

    return matchesStatus && matchesCategory && matchesSearch;
  });

  const pendingCount = materials.filter(m => m.status === 'pending' || m.status === 'assistant_approved').length;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <FileCheck2 className="w-5 h-5 text-blue-600" />
                <span>学生申报材料协同审核中心</span>
              </h2>
              {pendingCount > 0 && (
                <span className="px-2.5 py-0.5 text-xs font-bold bg-amber-500 text-white rounded-full">
                  待审核 {pendingCount} 件
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              由辅导员与班级学生助理协同核查加分证明材料。核准后自动将分数计入综测对应模块，不通过则不计分并提供退回说明。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500 hidden sm:inline">审核身份:</span>
            <span className="px-3 py-1 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold text-xs rounded-xl border border-blue-200 dark:border-blue-800">
              {currentUser.name} ({currentUser.role === 'counselor' ? '辅导员' : currentUser.role === 'admin' ? '系统管理员' : '学委/班委'})
            </span>
            <button
              onClick={() => exportMaterialAuditRecordsExcel(filteredMaterials, `加分材料审核明细表_${selectedStatus}.xlsx`)}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl flex items-center space-x-1 shadow-sm transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>导出材料审核 Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 'pending', label: `待审核 (${pendingCount})` },
            { id: 'approved', label: '已审核通过' },
            { id: 'rejected', label: '已被退回' },
            { id: 'all', label: '全部记录' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedStatus(tab.id)}
              className={`px-3.5 py-2 rounded-xl font-bold whitespace-nowrap transition-all ${
                selectedStatus === tab.id
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="搜索学号、姓名、材料名称..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="w-full sm:w-auto px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
          >
            <option value="all">全部分类模块</option>
            <option value="moral">德育</option>
            <option value="intellectual">智育</option>
            <option value="physical">体育</option>
            <option value="ability">能力</option>
            <option value="aesthetics">美育</option>
            <option value="labor">劳动</option>
            <option value="extra">附加加分</option>
          </select>
        </div>
      </div>

      {/* Materials List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredMaterials.length === 0 ? (
          <div className="col-span-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-slate-400 text-xs">
            未筛选到符合条件的材料记录。
          </div>
        ) : (
          filteredMaterials.map(mat => (
            <div
              key={mat.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-900">
                      {mat.categoryName}
                    </span>
                    {(currentUser.role === 'assistant' && mat.studentId === currentUser.studentId) && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 rounded-full">
                        学委/班委申报
                      </span>
                    )}
                  </div>

                  {mat.status === 'pending' && (
                    <span className="flex items-center text-amber-600 font-semibold text-[11px]">
                      <Clock className="w-3.5 h-3.5 mr-1" /> 待复核
                    </span>
                  )}
                  {mat.status === 'approved' && (
                    <span className="flex items-center text-emerald-600 font-semibold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 已通过 (+{mat.approvedScore}分)
                    </span>
                  )}
                  {mat.status === 'rejected' && (
                    <span className="flex items-center text-rose-600 font-semibold text-[11px]">
                      <XCircle className="w-3.5 h-3.5 mr-1" /> 已退回
                    </span>
                  )}
                </div>

                <h3 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-1">
                  {mat.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">
                  {mat.description}
                </p>
                {mat.awardMonth && (
                  <div className="mt-2 text-[10px] text-blue-600 dark:text-blue-400 font-semibold">
                    获奖时间：{mat.awardMonth}
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{mat.studentName}</span>
                    <span className="text-[10px] text-slate-400 block font-mono">{mat.studentId} · {mat.majorClass}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">申请加分</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">+{mat.requestedScore} 分</span>
                  </div>
                </div>
              </div>

              {/* Review History / Button */}
              <div>
                {mat.status === 'rejected' && mat.rejectReason && (
                  <div className="mb-3 p-2 bg-rose-50 dark:bg-rose-950/40 text-[11px] text-rose-600 dark:text-rose-300 rounded-lg border border-rose-200 dark:border-rose-900 flex items-start space-x-1">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">驳回原因：{mat.rejectReason}</span>
                  </div>
                )}

                <button
                  onClick={() => openReviewModal(mat)}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center space-x-1.5 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{currentUser.role === 'admin' ? '查看材料流转详情' : mat.status === 'pending' ? '审查该材料附件并打分' : '查看审查详情'}</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Detail Review Modal */}
      {activeMaterial && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm overflow-y-auto">
          <div className="surface-elevated rounded-2xl w-full max-w-2xl p-6 space-y-5 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
                  {activeMaterial.categoryName} · {activeMaterial.academicYear}学年
                </span>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                  {activeMaterial.title}
                </h3>
              </div>
              <button
                onClick={() => setActiveMaterial(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            {/* Student Info Box */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">申报学生</span>
                <span className="font-bold text-slate-900 dark:text-white">{activeMaterial.studentName}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">学号 / 班级</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">{activeMaterial.studentId} · {activeMaterial.majorClass}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">申请分数</span>
                <span className="font-bold text-blue-600">+{activeMaterial.requestedScore} 分</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">获奖时间</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">{activeMaterial.awardMonth || '-'}</span>
              </div>
            </div>

            {/* Proof Material Preview */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                证明材料附件影印件
              </label>
              {activeMaterial.proofUrl ? (
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950 max-h-64 flex items-center justify-center">
                  <img
                    src={activeMaterial.proofUrl}
                    alt="Proof Certificate"
                    className="object-contain max-h-64 w-full"
                  />
                </div>
              ) : (
                <div className="p-8 text-center bg-slate-100 dark:bg-slate-800 rounded-xl text-xs text-slate-400">
                  无图片附件，提交文本说明
                </div>
              )}
            </div>

            {/* Description */}
            <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl">
              <span className="font-semibold block mb-1">学生提交说明：</span>
              {activeMaterial.description}
            </div>

            {/* Score & Review Action Panel */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
              {currentUser.role === 'assistant' && activeMaterial.studentId === currentUser.studentId ? (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-2xl space-y-2">
                  <div className="flex items-center space-x-2 text-amber-800 dark:text-amber-300 font-bold text-xs">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>提示：班委/学委本人申报规则</span>
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                    本材料为您的个人加分申报。按综测监管规则，班委/学委本人的申报材料需直接交由辅导员老师负责审核评定，班委无法自我审查打分。
                  </p>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      disabled
                      className="px-4 py-2 bg-slate-200 dark:bg-slate-800 text-slate-500 text-xs font-semibold rounded-xl cursor-not-allowed"
                    >
                      等待辅导员审核
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {currentUser.role === 'counselor' && activeMaterial.reviewerRole === 'assistant' && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl text-xs text-amber-700 dark:text-amber-300 flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                      <span>班委已初审通过，请辅导员进行终审。</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        核准加入加分 (0 - 10分)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        value={reviewScore}
                        onChange={e => setReviewScore(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-blue-600"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        退回说明 (仅不通过时必填)
                      </label>
                      <input
                        type="text"
                        placeholder="如：证明图片不清，请重新拍照上传..."
                        value={rejectReason}
                        onChange={e => setRejectReason(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={handleReject}
                      className="w-full sm:w-auto justify-center px-4 py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 border border-rose-200 dark:border-rose-900 text-xs font-bold rounded-xl flex items-center space-x-1 cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>退回驳回</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleApprove}
                      className="w-full sm:w-auto justify-center px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1 shadow-md shadow-blue-600/20 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{currentUser.role === 'assistant' ? '初审通过并提交辅导员终审' : '终审通过并计入综测总分'}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
