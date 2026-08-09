import React, { useEffect, useMemo, useState } from 'react';
import { User, StudentScoreSummary, ProofMaterial } from '../../types';
import { Users, Award, FileCheck2, ShieldCheck, TrendingUp, Sparkles, ArrowRight, Clock, BarChart3, PieChart as PieIcon, Activity, Filter } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts';
import { classScopeKey, normalizeClassName, resolveStudentGrade, sameClassScope } from '../../utils/className';

interface OverviewDashboardProps {
  currentUser: User;
  summaries: StudentScoreSummary[];
  materials: ProofMaterial[];
  activeAcademicYear: string;
  rulesLocked: boolean;
  onNavigateTab: (tab: any) => void;
}

export const OverviewDashboard: React.FC<OverviewDashboardProps> = ({
  currentUser,
  summaries,
  materials,
  activeAcademicYear,
  rulesLocked,
  onNavigateTab
}) => {
  const [selectedClassKey, setSelectedClassKey] = useState<string>('all');
  const isAdminOrCounselor = currentUser.role === 'admin' || currentUser.role === 'counselor';

  // 班级筛选后的数据
  const availableClasses = useMemo(() => {
    const options = new Map<string, { key: string; className: string; grade: string; label: string }>();
    const gradeCountByClass = new Map<string, Set<string>>();
    summaries.forEach(summary => {
      const classKey = normalizeClassName(summary.majorClass);
      const grade = resolveStudentGrade(summary.grade, summary.majorClass, summary.studentId);
      if (!classKey) return;
      const grades = gradeCountByClass.get(classKey) || new Set<string>();
      if (grade) grades.add(grade);
      gradeCountByClass.set(classKey, grades);
    });
    summaries.forEach(summary => {
      const key = classScopeKey(summary.majorClass, summary.grade, summary.studentId);
      if (!normalizeClassName(summary.majorClass) || options.has(key)) return;
      const grade = resolveStudentGrade(summary.grade, summary.majorClass, summary.studentId);
      const hasMultipleGrades = (gradeCountByClass.get(normalizeClassName(summary.majorClass))?.size || 0) > 1;
      options.set(key, {
        key,
        className: summary.majorClass,
        grade,
        label: hasMultipleGrades && grade ? `${grade} ${summary.majorClass}` : summary.majorClass,
      });
    });
    return Array.from(options.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }, [summaries]);
  const selectedClass = useMemo(
    () => availableClasses.find(option => option.key === selectedClassKey) || null,
    [availableClasses, selectedClassKey]
  );
  useEffect(() => {
    if (selectedClassKey !== 'all' && !selectedClass) setSelectedClassKey('all');
  }, [selectedClassKey, selectedClass]);
  const displaySummaries = useMemo(() =>
    selectedClassKey === 'all' || !selectedClass
      ? summaries
      : summaries.filter(summary => sameClassScope(
          summary.majorClass,
          summary.grade,
          selectedClass.className,
          selectedClass.grade,
          summary.studentId,
        )),
    [summaries, selectedClassKey, selectedClass]
  );
  const displayMaterials = useMemo(() =>
    selectedClassKey === 'all' || !selectedClass ? materials : materials.filter(m => {
      const s = summaries.find(x => x.studentId === m.studentId);
      return Boolean(s && sameClassScope(
        s.majorClass,
        s.grade,
        selectedClass.className,
        selectedClass.grade,
        s.studentId,
      ));
    }),
    [materials, summaries, selectedClassKey, selectedClass]
  );

  const pendingMaterials = displayMaterials.filter(m => m.status === 'pending' || m.status === 'assistant_approved');
  const approvedMaterials = displayMaterials.filter(m => m.status === 'approved');

  const topStudents = [...displaySummaries].sort((a, b) => b.totalScore - a.totalScore).slice(0, 5);

  // 1. 各班级综测均分与最高分柱状图数据
  const classData = useMemo(() => {
    const map: { [key: string]: { class: string; avgTotal: number; maxTotal: number; count: number; moralAvg: number; intellectualAvg: number; physicalAvg: number; abilityAvg: number; aestheticsAvg: number; laborAvg: number; } } = {};

    displaySummaries.forEach(s => {
      const cls = s.majorClass || '通用班级';
      if (!map[cls]) {
        map[cls] = { class: cls, avgTotal: 0, maxTotal: 0, count: 0, moralAvg: 0, intellectualAvg: 0, physicalAvg: 0, abilityAvg: 0, aestheticsAvg: 0, laborAvg: 0 };
      }
      map[cls].avgTotal += s.totalScore;
      if (s.totalScore > map[cls].maxTotal) map[cls].maxTotal = s.totalScore;
      map[cls].moralAvg += s.moralFinal;
      map[cls].intellectualAvg += s.intellectualFinal;
      map[cls].physicalAvg += s.physicalFinal;
      map[cls].abilityAvg += s.abilityFinal;
      map[cls].aestheticsAvg += s.aestheticsFinal;
      map[cls].laborAvg += s.laborFinal;
      map[cls].count += 1;
    });

    return Object.values(map).map(item => ({
      className: item.class,
      '班级平均分': Number((item.avgTotal / item.count).toFixed(2)),
      '班级最高分': Number(item.maxTotal.toFixed(2)),
      '德育均分': Number((item.moralAvg / item.count).toFixed(2)),
      '智育均分': Number((item.intellectualAvg / item.count).toFixed(2)),
      '体育均分': Number((item.physicalAvg / item.count).toFixed(2)),
      '能力均分': Number((item.abilityAvg / item.count).toFixed(2)),
      '美育均分': Number((item.aestheticsAvg / item.count).toFixed(2)),
      '劳育均分': Number((item.laborAvg / item.count).toFixed(2)),
    }));
  }, [displaySummaries]);

  // 2. 成绩分数段分布折线/面积图数据
  const scoreDistributionData = useMemo(() => {
    const tiers = [
      { range: '90分及以上(优秀)', min: 90, max: 100, count: 0 },
      { range: '85-89分(良好)', min: 85, max: 89.99, count: 0 },
      { range: '80-84分(中等)', min: 80, max: 84.99, count: 0 },
      { range: '75-79分(合格)', min: 75, max: 79.99, count: 0 },
      { range: '75分以下(需改进)', min: 0, max: 74.99, count: 0 },
    ];

    displaySummaries.forEach(s => {
      const found = tiers.find(t => s.totalScore >= t.min && s.totalScore <= t.max);
      if (found) found.count += 1;
    });

    let runningTotal = 0;
    const total = displaySummaries.length || 1;
    return tiers.map(t => {
      runningTotal += t.count;
      const ratio = Number(((t.count / total) * 100).toFixed(1));
      const cumRatio = Number(((runningTotal / total) * 100).toFixed(1));
      return { name: t.range, '区间人数': t.count, '占比(%)': ratio, '累计占比(%)': cumRatio };
    });
  }, [displaySummaries]);

  // 3. 各维度申报材料状态分布堆叠图数据
  const materialCategoryData = useMemo(() => {
    const catMap: { [key: string]: { approved: number; pending: number; rejected: number; label: string } } = {
      moral: { approved: 0, pending: 0, rejected: 0, label: '德育' },
      intellectual: { approved: 0, pending: 0, rejected: 0, label: '智育' },
      physical: { approved: 0, pending: 0, rejected: 0, label: '体育' },
      ability: { approved: 0, pending: 0, rejected: 0, label: '能力' },
      aesthetics: { approved: 0, pending: 0, rejected: 0, label: '美育' },
      labor: { approved: 0, pending: 0, rejected: 0, label: '劳动' },
    };

    displayMaterials.forEach(m => {
      const key = m.categoryId || m.category;
      if (catMap[key]) {
        if (m.status === 'approved') catMap[key].approved += 1;
        else if (m.status === 'rejected') catMap[key].rejected += 1;
        else catMap[key].pending += 1; // pending + assistant_approved
      }
    });

    return Object.entries(catMap).map(([key, v]) => ({
      category: v.label,
      '通过核准': v.approved,
      '待审复核': v.pending,
      '退回修改': v.rejected,
    }));
  }, [displayMaterials]);

  return (
    <div className="space-y-6">
      {/* Welcome & System Status Hero Banner */}
      <div className="surface-elevated text-slate-900 dark:text-white rounded-2xl p-6 md:p-8 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="min-w-0">
            <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300 mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="min-w-0 truncate">{activeAcademicYear} 学年综测全流程监控中心</span>
            </div>
            <h1 className="break-words text-2xl font-bold tracking-tight">
              欢迎登录，{currentUser.name} {currentUser.title ? `(${currentUser.title})` : ''}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
              当前系统运行正常，六大素质维度分值占比与规则（德育20%、智育40%、体育10%、能力10%、美育10%、劳动10%）实时演算中。共有 {displaySummaries.length} 名在校生参与本学年综测评估。
            </p>
          </div>

          <div className="flex w-full items-center gap-3 md:w-auto">
            <button
              onClick={() => onNavigateTab(currentUser.role === 'student' ? 'my-materials' : 'audit-center')}
              className="motion-lift flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-blue-600/20 transition-all hover:bg-blue-700 md:w-auto"
            >
              <span>{currentUser.role === 'student' ? '去提交申报材料' : '处理材料审核'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 4 Stat Metric Blocks */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8 pt-6 border-t border-white/10 relative z-10 text-xs">
          <div className="motion-lift bg-white/70 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 rounded-lg p-4 backdrop-blur-md">
            <div className="text-slate-500 dark:text-slate-400">在册评估学生</div>
            <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1">{displaySummaries.length} 人</div>
            <div className="text-[10px] text-blue-600 dark:text-blue-300 mt-1">数据科学与工程学院</div>
          </div>

          <div className="motion-lift bg-white/70 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 rounded-lg p-4 backdrop-blur-md">
            <div className="text-slate-500 dark:text-slate-400">待复核材料</div>
            <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-300 mt-1">{pendingMaterials.length} 件</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-300 mt-1">辅导员/助理协同审核</div>
          </div>

          <div className="motion-lift bg-white/70 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 rounded-lg p-4 backdrop-blur-md">
            <div className="text-slate-500 dark:text-slate-400">已核准加分项</div>
            <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-300 mt-1">{approvedMaterials.length} 项</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-300 mt-1">已计入综测总分</div>
          </div>

          <div className="motion-lift bg-white/70 dark:bg-white/[0.06] border border-slate-200 dark:border-white/10 rounded-lg p-4 backdrop-blur-md">
            <div className="text-slate-500 dark:text-slate-400">加分规则状态</div>
            <div className="text-lg font-bold text-blue-600 dark:text-blue-300 mt-1">
              {rulesLocked ? '🔒 已全域锁死' : '🔓 允许管理员编辑'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-300 mt-1">防篡改保护引擎</div>
          </div>
        </div>
      </div>

      {/* 班级筛选器（辅导员和管理员可见） */}
      {isAdminOrCounselor && availableClasses.length > 0 && (
        <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-3 flex flex-col items-stretch gap-3 text-xs sm:flex-row sm:items-center">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="shrink-0 text-slate-500 font-semibold">班级筛选：</span>
          <select value={selectedClassKey} onChange={e => setSelectedClassKey(e.target.value)} className="min-w-0 px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border rounded-xl font-medium text-blue-600 dark:text-blue-400">
            <option value="all">全部班级 ({summaries.length}人)</option>
            {availableClasses.map(option => {
              const count = summaries.filter(summary => sameClassScope(
                summary.majorClass,
                summary.grade,
                option.className,
                option.grade,
                summary.studentId,
              )).length;
              return <option key={option.key} value={option.key}>{option.label} ({count}人)</option>;
            })}
          </select>
        </div>
      )}

      {/* Visual Data Analytics Section: Recharts Bar & Line Visualization */}
      <div className="space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="flex min-w-0 items-start gap-2 text-lg font-bold text-slate-900 dark:text-white sm:items-center">
            <BarChart3 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span className="min-w-0">综测数据库图表与多维分析中心</span>
          </h2>
          <span className="shrink-0 text-xs text-slate-400 font-mono">基于实时数据库计算更新 · {displaySummaries.length} 人</span>
        </div>

        {/* Charts Row 1: Bar Chart & Line Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Chart 1: Bar Chart for Class Average & Max Scores */}
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="flex min-w-0 items-start gap-2 text-sm font-bold text-slate-900 dark:text-white sm:items-center">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  <span className="min-w-0">各班级综测平均分与最高分对比 (柱状图)</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  直观反映各班级总体学术与综测水平分布
                </p>
              </div>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={classData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                  <XAxis dataKey="className" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#FFF', fontSize: '12px' }}
                    itemStyle={{ color: '#F8FAFC' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Bar dataKey="班级平均分" fill="#6366F1" radius={[6, 6, 0, 0]} barSize={20} />
                  <Bar dataKey="班级最高分" fill="#10B981" radius={[6, 6, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Line Chart for Multi-Dimension Six Scores Comparison */}
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="flex min-w-0 items-start gap-2 text-sm font-bold text-slate-900 dark:text-white sm:items-center">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  <span className="min-w-0">六大素质维度班级均分走势 (折线图)</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  对比各班在德、智、体、创、美、劳各单项的均衡发展程度
                </p>
              </div>
            </div>

            <div className="h-64 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={classData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                  <XAxis dataKey="className" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis domain={[60, 100]} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#FFF', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  <Line type="monotone" dataKey="德育均分" stroke="#EF4444" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="智育均分" stroke="#3B82F6" strokeWidth={2.5} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="体育均分" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="能力均分" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="美育均分" stroke="#8B5CF6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="劳育均分" stroke="#EC4899" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Charts Row 2: Score Tier Area Chart & Material Submissions Stacked Bar Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Chart 3: Score Distribution Area/Line Chart */}
          <div className="lg:col-span-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="flex min-w-0 items-start gap-2 text-sm font-bold text-slate-900 dark:text-white sm:items-center">
                <PieIcon className="w-4 h-4 text-purple-500" />
                <span className="min-w-0">综测成绩分数段分布与累计占比 (面积折线图)</span>
              </h3>
            </div>

            <div className="h-60 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={scoreDistributionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRatio" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#FFF', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Bar dataKey="区间人数" fill="#6366F1" radius={[4, 4, 0, 0]} barSize={18} />
                  <Area type="monotone" dataKey="累计占比(%)" stroke="#8B5CF6" fillOpacity={1} fill="url(#colorRatio)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 4: Proof Material Status by Category Stacked Bar Chart */}
          <div className="lg:col-span-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h3 className="flex min-w-0 items-start gap-2 text-sm font-bold text-slate-900 dark:text-white sm:items-center">
                <FileCheck2 className="w-4 h-4 text-blue-500" />
                <span className="min-w-0">各素质维度申报材料处理状态 (堆叠柱状图)</span>
              </h3>
            </div>

            <div className="h-60 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={materialCategoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.5} />
                  <XAxis dataKey="category" tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#64748B' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0F172A', borderColor: '#334155', borderRadius: '12px', color: '#FFF', fontSize: '12px' }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                  <Bar dataKey="通过核准" stackId="a" fill="#10B981" radius={[0, 0, 0, 0]} barSize={22} />
                  <Bar dataKey="待审复核" stackId="a" fill="#F59E0B" radius={[0, 0, 0, 0]} barSize={22} />
                  <Bar dataKey="退回修改" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Grid: Top Students Leaderboard & Recent Submissions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Top Rank Leaderboard */}
        <div className="lg:col-span-7 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex flex-col gap-2 border-b border-slate-100 pb-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="flex min-w-0 items-start gap-2 text-base font-bold text-slate-900 dark:text-white sm:items-center">
                <Award className="w-5 h-5 text-amber-500" />
                <span className="min-w-0">综合测评年级榜首Top 5 实时预警看板</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                实时根据【德+智+体+创+志】动态算分更新排名。
              </p>
            </div>

            <button
              onClick={() => onNavigateTab('score-export')}
              className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
            >
              查看全榜名次 →
            </button>
          </div>

          <div className="space-y-3">
            {topStudents.map((s, idx) => (
              <div
                key={s.studentId}
                className="p-3.5 bg-slate-50/70 dark:bg-slate-800/50 backdrop-blur-sm border border-slate-200/60 dark:border-slate-800/80 rounded-xl flex items-center justify-between gap-3"
              >
                <div className="flex min-w-0 items-center space-x-3">
                  <div className={`w-7 h-7 rounded-full font-mono font-bold text-xs flex items-center justify-center ${
                    idx === 0 ? 'bg-amber-500 text-white shadow-md' :
                    idx === 1 ? 'bg-slate-300 text-slate-900' :
                    idx === 2 ? 'bg-amber-700 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}>
                    {idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-bold text-xs text-slate-900 dark:text-white">
                      <span className="min-w-0 truncate">{s.studentName}</span>
                      <span className="shrink-0 text-[10px] text-slate-400 font-normal font-mono">{s.studentId}</span>
                    </div>
                    <div className="truncate text-[10px] text-slate-500">{s.majorClass} · {s.college}</div>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold text-blue-600 dark:text-blue-400 font-mono">
                    {s.totalScore} 分
                  </div>
                  <div className="text-[10px] text-slate-400">
                    班级第 {s.classRank} 名
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Dynamic Activity Feed */}
        <div className="lg:col-span-5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="flex min-w-0 items-start gap-2 text-base font-bold text-slate-900 dark:text-white sm:items-center">
              <Clock className="w-5 h-5 text-blue-600" />
              <span className="min-w-0">最新申报与审核动态</span>
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            {materials.slice(0, 4).map(mat => (
              <div key={mat.id} className="p-3 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl space-y-1">
                <div className="flex items-center justify-between gap-2 font-medium">
                  <span className="min-w-0 truncate text-slate-900 dark:text-white font-bold">{mat.studentName}</span>
                  <span className={`px-2 py-0.5 text-[10px] rounded font-semibold ${
                    mat.status === 'approved' ? 'bg-emerald-50 text-emerald-600' :
                    mat.status === 'rejected' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    {mat.status === 'approved' ? '通过' : mat.status === 'rejected' ? '驳回' : '待处理'}
                  </span>
                </div>
                <p className="text-slate-500 line-clamp-1">{mat.title}</p>
                <div className="text-[10px] text-slate-400">{mat.awardMonth ? `获奖 ${mat.awardMonth} · ` : ''}{mat.submittedAt}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
