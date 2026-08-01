import React from 'react';
import { User, StudentScoreSummary, ProofMaterial } from '../../types';
import { Printer, ArrowLeft, FileText } from 'lucide-react';
import { exportComprehensiveScoreExcel } from '../../utils/excel';
import { apiService } from '../../services/api';

interface PersonalReportPDFProps {
  currentUser: User;
  summary: StudentScoreSummary | null;
  materials: ProofMaterial[];
  activeAcademicYear: string;
  onBack: () => void;
}

export const PersonalReportPDF: React.FC<PersonalReportPDFProps> = ({
  currentUser,
  summary,
  materials,
  activeAcademicYear,
  onBack
}) => {
  const studentApprovedMaterials = materials.filter(
    m => m.studentId === currentUser.studentId && m.academicYear === activeAcademicYear && m.status === 'approved'
  );

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Printable Control Action Bar (Hidden during printing) */}
      <div className="print:hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回个人看板</span>
        </button>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => currentUser.studentDbId && apiService.openAuthorizedPage('/files/export-pdf/' + encodeURIComponent(currentUser.studentDbId) + '?yearId=' + encodeURIComponent(activeAcademicYear))}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            <span>打开服务器成绩报告</span>
          </button>
          <button
            onClick={handlePrint}
            className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl flex items-center space-x-2 shadow-md shadow-amber-500/20 transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>打印 / 导出 PDF 成绩单档案</span>
          </button>
        </div>
      </div>

      {/* Official Sheet Container (Designed to look like real university transcript) */}
      <div className="bg-white text-slate-900 border border-slate-300 rounded-xl p-8 md:p-12 shadow-lg max-w-4xl mx-auto space-y-6 print:shadow-none print:border-none print:p-0">
        {/* Header */}
        <div className="text-center space-y-2 border-b-2 border-slate-900 pb-6">
          <div className="text-xs font-bold tracking-widest text-slate-500 uppercase">
            HIGHER EDUCATION COMPREHENSIVE EVALUATION RECORD
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            高校学生综合素质测评登记档案表
          </h1>
          <div className="text-xs font-semibold text-slate-700 font-mono">
            【 {activeAcademicYear} 学年 】
          </div>
        </div>

        {/* Student Basic Info Table */}
        <div className="border border-slate-900 text-xs divide-y divide-slate-900">
          <div className="grid grid-cols-4 divide-x divide-slate-900 bg-slate-50 font-medium">
            <div className="p-2.5 font-bold text-center bg-slate-100">姓名</div>
            <div className="p-2.5 font-bold text-center">{currentUser.name}</div>
            <div className="p-2.5 font-bold text-center bg-slate-100">学号</div>
            <div className="p-2.5 font-bold text-center font-mono">{currentUser.studentId}</div>
          </div>

          <div className="grid grid-cols-4 divide-x divide-slate-900 bg-slate-50 font-medium">
            <div className="p-2.5 font-bold text-center bg-slate-100">学院</div>
            <div className="p-2.5 text-center">{currentUser.college}</div>
            <div className="p-2.5 font-bold text-center bg-slate-100">年级 / 班级</div>
            <div className="p-2.5 text-center">{currentUser.grade} {currentUser.majorClass}</div>
          </div>
        </div>

        {/* Module Scores Grid */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-l-4 border-slate-900 pl-2">
            一、综合素质六维度分模块测评结果
          </h3>

          <div className="border border-slate-900 text-xs">
            <table className="w-full text-center border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-900 font-bold">
                  <th className="p-2 border-r border-slate-900">测评维度</th>
                  <th className="p-2 border-r border-slate-900">权重</th>
                  <th className="p-2 border-r border-slate-900">基础分</th>
                  <th className="p-2 border-r border-slate-900">加分</th>
                  <th className="p-2">加权得分</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                <tr>
                  <td className="p-2 font-bold border-r border-slate-900">德育</td>
                  <td className="p-2 border-r border-slate-900 font-mono">×0.20</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.moralBase ?? 60}</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.moralBonus ?? 0} (扣{summary?.moralDeduction ?? 0})</td>
                  <td className="p-2 font-bold font-mono">{summary?.moralFinal.toFixed(1) ?? 60}</td>
                </tr>
                <tr>
                  <td className="p-2 font-bold border-r border-slate-900">智育</td>
                  <td className="p-2 border-r border-slate-900 font-mono">×0.40</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.intellectualBase ?? 85}</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.intellectualBonus ?? 0}</td>
                  <td className="p-2 font-bold font-mono">{summary?.intellectualFinal.toFixed(1) ?? 85}</td>
                </tr>
                <tr>
                  <td className="p-2 font-bold border-r border-slate-900">体育</td>
                  <td className="p-2 border-r border-slate-900 font-mono">×0.10</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.physicalBase ?? 50}</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.physicalBonus ?? 0}</td>
                  <td className="p-2 font-bold font-mono">{summary?.physicalFinal.toFixed(1) ?? 50}</td>
                </tr>
                <tr>
                  <td className="p-2 font-bold border-r border-slate-900">能力</td>
                  <td className="p-2 border-r border-slate-900 font-mono">×0.10</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.abilityBase ?? 60}</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.abilityBonus ?? 0}</td>
                  <td className="p-2 font-bold font-mono">{summary?.abilityFinal.toFixed(1) ?? 60}</td>
                </tr>
                <tr>
                  <td className="p-2 font-bold border-r border-slate-900">美育</td>
                  <td className="p-2 border-r border-slate-900 font-mono">×0.10</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.aestheticsBase ?? 60}</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.aestheticsBonus ?? 0}</td>
                  <td className="p-2 font-bold font-mono">{summary?.aestheticsFinal.toFixed(1) ?? 60}</td>
                </tr>
                <tr>
                  <td className="p-2 font-bold border-r border-slate-900">劳动</td>
                  <td className="p-2 border-r border-slate-900 font-mono">×0.10</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.laborBase ?? 60}</td>
                  <td className="p-2 border-r border-slate-900 font-mono">{summary?.laborBonus ?? 0}</td>
                  <td className="p-2 font-bold font-mono">{summary?.laborFinal.toFixed(1) ?? 60}</td>
                </tr>
                <tr className="bg-slate-50 font-bold border-t-2 border-slate-900">
                  <td colSpan={2} className="p-2.5 text-right border-r border-slate-900">综测总分</td>
                  <td colSpan={3} className="p-2.5 text-left pl-6 font-mono text-base text-slate-900">
                    {summary?.totalScore} 分 · {summary?.evaluationGrade} · 班级第 {summary?.classRank}/{summary?.classTotal} 名
                    {summary?.isDisqualified && <span className="text-rose-600 ml-2 font-normal text-xs">(注: 单项不及格, 无评奖资格)</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Approved Bonus Items Detail */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-l-4 border-slate-900 pl-2">
            二、已核准加分项目与证明细则
          </h3>

          <div className="border border-slate-900 text-xs p-3 space-y-2">
            {studentApprovedMaterials.length === 0 ? (
              <div className="text-center py-3 text-slate-500">
                本学年无核准加分项目记录。
              </div>
            ) : (
              studentApprovedMaterials.map((item, idx) => (
                <div key={item.id} className="flex justify-between items-center py-1 border-b border-slate-200 last:border-none">
                  <div className="space-x-2">
                    <span className="font-bold">[{item.categoryName}]</span>
                    <span>{item.title}</span>
                  </div>
                  <div className="font-mono font-bold text-slate-900">
                    +{item.approvedScore} 分
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Signatures & Seal Area */}
        <div className="pt-6 border-t border-slate-900 grid grid-cols-3 gap-6 text-xs text-slate-700">
          <div className="space-y-8">
            <div>班级测评小组审核人签字：</div>
            <div className="border-b border-slate-400 w-3/4"></div>
            <div>日期： 2026 年 ___ 月 ___ 日</div>
          </div>

          <div className="space-y-8">
            <div>年级辅导员复核签字：</div>
            <div className="border-b border-slate-400 w-3/4"></div>
            <div>日期： 2026 年 ___ 月 ___ 日</div>
          </div>

          <div className="relative space-y-8 text-center flex flex-col items-center justify-between">
            <div>学院综测审核委员会 (盖章)</div>
            {/* Simulated Official Seal */}
            <div className="w-24 h-24 rounded-full border-2 border-rose-600/80 text-rose-600 flex flex-col items-center justify-center p-1 transform -rotate-12 opacity-80 pointer-events-none my-2">
              <span className="text-[9px] font-bold">数据科学与工程学院</span>
              <span className="text-[8px]">★ 综测审核专用章 ★</span>
              <span className="text-[8px] font-mono">2026.09</span>
            </div>
            <div>日期： 2026 年 ___ 月 ___ 日</div>
          </div>
        </div>
      </div>
    </div>
  );
};
