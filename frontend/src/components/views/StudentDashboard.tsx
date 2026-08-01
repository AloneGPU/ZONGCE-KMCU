import React, { useState } from 'react';
import { User, StudentScoreSummary, ProofMaterial, RuleCategoryConfig, AcademicYearConfig } from '../../types';
import { Award, Plus, FileText, CheckCircle2, Clock, XCircle, Trash2, Edit2, Download, Sparkles, TrendingUp, HelpCircle } from 'lucide-react';
import confetti from 'canvas-confetti';

interface StudentDashboardProps {
  currentUser: User;
  summary: StudentScoreSummary | null;
  materials: ProofMaterial[];
  ruleConfigs: RuleCategoryConfig[];
  activeAcademicYear: string;
  academicYears: AcademicYearConfig[];
  onOpenUploadModal: () => void;
  onDeleteMaterial: (id: string) => void;
  onNavigateToPDF: () => void;
  focusView?: 'overview' | 'materials';
}

export const StudentDashboard: React.FC<StudentDashboardProps> = ({
  currentUser,
  summary,
  materials,
  ruleConfigs,
  activeAcademicYear,
  academicYears,
  onOpenUploadModal,
  onDeleteMaterial,
  onNavigateToPDF,
  focusView = 'overview'
}) => {
  const [materialFilter, setMaterialFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  const studentMaterials = materials.filter(
    m => m.studentId === currentUser.studentId && m.academicYear === activeAcademicYear
  );

  const filteredMaterials = studentMaterials.filter(m => {
    if (materialFilter === 'all') return true;
    // pending 标签同时显示 pending 和 assistant_approved
    if (materialFilter === 'pending') return m.status === 'pending' || m.status === 'assistant_approved';
    return m.status === materialFilter;
  });

  const activeYearObj = academicYears.find(y => y.year === activeAcademicYear);

  if (focusView === 'materials') {
    return (
      <div className="space-y-6">
        {/* Dedicated Material Declaration Header */}
        <div className="surface-elevated text-slate-900 dark:text-white rounded-2xl p-6 md:p-8 relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs font-semibold">
              <FileText className="w-3.5 h-3.5" />
              <span>加分材料申报与管理中心</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              {currentUser.name} 同学 · 证明材料申报
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              提交学术竞赛、社会工作、志愿服务及文体获奖等证明材料，经初审核对后自动记入综测加分
            </p>
          </div>

          <div className="flex items-center space-x-3 w-full md:w-auto">
            <button
              onClick={onOpenUploadModal}
              disabled={activeYearObj?.isLocked}
              className={`w-full md:w-auto justify-center px-5 py-3 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 shadow-xl ${
                activeYearObj?.isLocked
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600 active:scale-95 text-white shadow-amber-500/30 cursor-pointer'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>立即提交新申报材料</span>
            </button>
          </div>
        </div>

        {/* Filter & Material List View */}
          <div className="surface-elevated rounded-2xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => {
                const count = st === 'all' ? studentMaterials.length : studentMaterials.filter(m => m.status === st).length;
                const labels = { all: '全部申报', pending: '待审核', approved: '已通过加分', rejected: '被退回' };
                return (
                  <button
                    key={st}
                    onClick={() => setMaterialFilter(st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      materialFilter === st
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {labels[st]} ({count})
                  </button>
                );
              })}
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              当前学年已核准算分: <span className="font-bold text-amber-600 dark:text-amber-400 font-mono">+{summary ? (summary.moralBonus + summary.intellectualBonus + summary.physicalBonus + summary.abilityBonus + summary.aestheticsBonus + summary.laborBonus + summary.extraBonus).toFixed(1) : 0} 分</span>
            </div>
          </div>

          {filteredMaterials.length === 0 ? (
            <div className="py-16 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
              <FileText className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700" />
              <div>暂无符合筛选条件的申报材料记录。</div>
              <button
                onClick={onOpenUploadModal}
                disabled={activeYearObj?.isLocked}
                className="inline-flex items-center space-x-1.5 px-4 py-2 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 rounded-xl font-bold text-xs border border-amber-200 dark:border-amber-800"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>新增第一份材料</span>
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredMaterials.map(mat => (
                <div
                  key={mat.id}
                  className="p-4 bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-blue-200 dark:hover:border-blue-800 transition-all"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900 rounded">
                        {mat.categoryName}
                      </span>
                      <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                        {mat.title}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {mat.description}
                    </p>
                    <div className="text-[10px] text-slate-400 flex items-center space-x-3">
                      <span>提交于: {mat.submittedAt}</span>
                      {mat.awardMonth && <span>获奖时间: {mat.awardMonth}</span>}
                      {mat.reviewerName && <span>审核员: {mat.reviewerName}</span>}
                    </div>
                  </div>

                  <div className="flex items-center space-x-4 self-end sm:self-center shrink-0">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block">申请分值</span>
                      <span className="font-bold text-amber-600 dark:text-amber-400 text-xs font-mono">+{mat.requestedScore} 分</span>
                    </div>

                    <div>
                      {mat.status === 'pending' && (
                        <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900 rounded-lg flex items-center">
                          <Clock className="w-3.5 h-3.5 mr-1 animate-pulse" /> 待班委审核
                        </span>
                      )}
                      {mat.status === 'assistant_approved' && (
                        <span className="px-2.5 py-1 text-xs font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900 rounded-lg flex items-center">
                          <Clock className="w-3.5 h-3.5 mr-1" /> 待辅导员终审
                        </span>
                      )}
                      {mat.status === 'approved' && (
                        <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 rounded-lg flex items-center">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> 已核准 (+{mat.approvedScore}分)
                        </span>
                      )}
                      {mat.status === 'rejected' && (
                        <span className="px-2.5 py-1 text-xs font-semibold bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 rounded-lg flex items-center" title={mat.rejectReason}>
                          <XCircle className="w-3.5 h-3.5 mr-1" /> 已退回: {mat.rejectReason || '材料不符合规范'}
                        </span>
                      )}
                    </div>

                    {mat.status !== 'approved' && !activeYearObj?.isLocked && (
                      <button
                        onClick={() => onDeleteMaterial(mat.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                        title="撤回删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Overview Card */}
      <div className="surface-elevated text-slate-900 dark:text-white rounded-2xl p-6 md:p-8 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-xs">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{activeAcademicYear} 学年综测成绩看板</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              你好，{currentUser.name} 同学！
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {currentUser.college} · {currentUser.majorClass} · 学号: {currentUser.studentId}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onOpenUploadModal}
              disabled={activeYearObj?.isLocked}
              className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 shadow-lg ${
                activeYearObj?.isLocked
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                  : 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>申报加分证明材料</span>
            </button>

            <button
              onClick={onNavigateToPDF}
              className="motion-lift px-4 py-2.5 bg-white/70 dark:bg-white/10 hover:bg-white/90 dark:hover:bg-white/20 text-slate-700 dark:text-white border border-slate-200 dark:border-white/20 rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 backdrop-blur-md"
            >
              <Download className="w-4 h-4" />
              <span>生成登记表 (PDF导出)</span>
            </button>
          </div>
        </div>

        {/* Score Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mt-8 pt-6 border-t border-slate-200/80 dark:border-white/10 relative z-10">
          <div className="bg-slate-50/85 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 backdrop-blur-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-300">综合测评总分</div>
            <div className="text-2xl font-bold text-slate-950 dark:text-white font-mono mt-1">
              {summary ? summary.totalScore : '--'}
            </div>
            <div className="text-[10px] text-amber-700 dark:text-amber-300 mt-1 flex items-center">
              <TrendingUp className="w-3 h-3 mr-1 inline" /> 2025版标准细则
            </div>
          </div>

          <div className="bg-slate-50/85 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 backdrop-blur-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-300">测评综合等级</div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-300 mt-1">
              {summary ? summary.evaluationGrade : '--'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-300 mt-1">
              {summary?.isDisqualified ? '存在不及格项(无评奖资格)' : '符合评优评奖资格'}
            </div>
          </div>

          <div className="bg-slate-50/85 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 backdrop-blur-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-300">班级排名</div>
            <div className="text-2xl font-bold text-cyan-700 dark:text-cyan-300 font-mono mt-1">
              {summary ? `${summary.classRank} / ${summary.classTotal}` : '--'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-300 mt-1">
              同班对比
            </div>
          </div>

          <div className="bg-slate-50/85 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 backdrop-blur-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-300">年级排名</div>
            <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-300 font-mono mt-1">
              {summary ? `${summary.gradeRank} / ${summary.gradeTotal}` : '--'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-300 mt-1">
              全年级排名
            </div>
          </div>

          <div className="bg-slate-50/85 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-2xl p-4 backdrop-blur-md">
            <div className="text-[11px] text-slate-500 dark:text-slate-300">已核准加分</div>
            <div className="text-2xl font-bold text-amber-700 dark:text-amber-300 font-mono mt-1">
              +{summary ? (summary.moralBonus + summary.intellectualBonus + summary.physicalBonus + summary.abilityBonus + summary.aestheticsBonus + summary.laborBonus + summary.extraBonus).toFixed(1) : 0} 分
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-300 mt-1">
              辅导员/助理核准
            </div>
          </div>
        </div>
      </div>

      {/* Six Module Score Progress Cards */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
          六大素质维度成绩明细 (2025全日制测评标准)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { title: '德育', weight: '20%', base: summary?.moralBase ?? 60, bonus: summary?.moralBonus ?? 0, deduction: summary?.moralDeduction ?? 0, final: summary?.moralFinal ?? 60, color: 'from-emerald-500 to-teal-600' },
            { title: '智育', weight: '40%', base: summary?.intellectualBase ?? 85, bonus: summary?.intellectualBonus ?? 0, deduction: 0, final: summary?.intellectualFinal ?? 85, color: 'from-blue-500 to-blue-600' },
            { title: '体育', weight: '10%', base: summary?.physicalBase ?? 50, bonus: summary?.physicalBonus ?? 0, deduction: 0, final: summary?.physicalFinal ?? 50, color: 'from-purple-500 to-violet-600' },
            { title: '能力', weight: '10%', base: summary?.abilityBase ?? 60, bonus: summary?.abilityBonus ?? 0, deduction: 0, final: summary?.abilityFinal ?? 60, color: 'from-amber-500 to-orange-600' },
            { title: '美育', weight: '10%', base: summary?.aestheticsBase ?? 60, bonus: summary?.aestheticsBonus ?? 0, deduction: 0, final: summary?.aestheticsFinal ?? 60, color: 'from-rose-500 to-pink-600' },
            { title: '劳动', weight: '10%', base: summary?.laborBase ?? 60, bonus: summary?.laborBonus ?? 0, deduction: 0, final: summary?.laborFinal ?? 60, color: 'from-sky-500 to-cyan-600' }
          ].map((mod, idx) => (
            <div key={idx} className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-xs text-slate-900 dark:text-white">{mod.title}</h4>
                  <span className="text-[10px] text-slate-400">权重 {mod.weight}</span>
                </div>
                <div className="text-right">
                  <span className="text-base font-bold text-slate-900 dark:text-white font-mono">
                    {mod.final.toFixed(1)}
                  </span>
                  <span className="text-[10px] text-slate-400 block">折算分</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${mod.color} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.min(100, mod.final)}%` }}
                />
              </div>

              <div className="flex justify-between text-[11px] text-slate-500 pt-1">
                <span>基础分: {mod.base}</span>
                <div className="space-x-2">
                  <span className="text-emerald-600 font-semibold">加分: +{mod.bonus}</span>
                  {mod.deduction > 0 && (
                    <span className="text-rose-600 font-semibold">扣分: -{mod.deduction}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* My Proof Material Submissions List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              已提交的加分证明材料 ({studentMaterials.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              上传获奖证书、竞赛证明、志愿工时截图等，经辅导员/助理核对后自动加分。
            </p>
          </div>

          <button
            onClick={onOpenUploadModal}
            disabled={activeYearObj?.isLocked}
            className="w-full sm:w-auto justify-center px-3.5 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-300 text-white text-xs font-semibold rounded-xl flex items-center space-x-1 shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新增材料申报</span>
          </button>
        </div>

        {studentMaterials.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            当前学年尚无申报材料。请点击右上角【新增材料申报】上传加分文件。
          </div>
        ) : (
          <div className="space-y-3">
            {studentMaterials.map(mat => (
              <div
                key={mat.id}
                className="p-4 bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 rounded">
                      {mat.categoryName}
                    </span>
                    <h4 className="font-bold text-xs text-slate-900 dark:text-white">
                      {mat.title}
                    </h4>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {mat.description}
                  </p>
                  <div className="text-[10px] text-slate-400">
                    提交于 {mat.submittedAt}
                    {mat.awardMonth ? ` · 获奖时间 ${mat.awardMonth}` : ''}
                  </div>
                </div>

                <div className="flex items-center space-x-4 self-end sm:self-center">
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 block">加分申请</span>
                    <span className="font-bold text-amber-600 text-xs">+{mat.requestedScore} 分</span>
                  </div>

                  <div>
                    {mat.status === 'pending' && (
                      <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-600 border border-amber-200 rounded-lg flex items-center">
                        <Clock className="w-3 h-3 mr-1" /> 待班委审核
                      </span>
                    )}
                    {mat.status === 'assistant_approved' && (
                      <span className="px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-200 rounded-lg flex items-center">
                        <Clock className="w-3 h-3 mr-1" /> 待辅导员终审
                      </span>
                    )}
                    {mat.status === 'approved' && (
                      <span className="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg flex items-center">
                        <CheckCircle2 className="w-3 h-3 mr-1" /> 已通过 (+{mat.approvedScore}分)
                      </span>
                    )}
                    {mat.status === 'rejected' && (
                      <span className="px-2.5 py-1 text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200 rounded-lg flex items-center" title={mat.rejectReason}>
                        <XCircle className="w-3 h-3 mr-1" /> 被退回
                      </span>
                    )}
                  </div>

                  {mat.status !== 'approved' && !activeYearObj?.isLocked && (
                    <button
                      onClick={() => onDeleteMaterial(mat.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg"
                      title="撤回删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
