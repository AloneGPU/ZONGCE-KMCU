import React, { useEffect, useMemo, useState } from 'react';
import { StudentScoreSummary, User } from '../../types';
import { apiService } from '../../services/api';
import { FileSpreadsheet, Download, Search, ShieldCheck } from 'lucide-react';
import { classScopeKey, normalizeClassName, normalizeGrade, resolveStudentGrade, sameClassScope } from '../../utils/className';

interface ExportCenterProps {
  summaries: StudentScoreSummary[];
  activeAcademicYear: string;
  currentUser: User;
}

interface ExportClassOption {
  key: string;
  className: string;
  grade: string;
  label: string;
}

type RankedDisplaySummary = StudentScoreSummary & {
  displayRank: number;
  displayScore: number;
  displayWeighted: number | null;
  displayModule: string | null;
  displayWeight: number | null;
};

const EXPORT_PROJECTS = [
  { value: 'comprehensive', label: '综合', moduleId: null },
  { value: 'aesthetics', label: '美育单项', moduleId: 5 },
  { value: 'moral', label: '德育单项', moduleId: 1 },
  { value: 'physical', label: '体育单项', moduleId: 3 },
  { value: 'intellectual', label: '智育单项', moduleId: 2 },
  { value: 'labor', label: '劳动单项', moduleId: 6 },
  { value: 'ability', label: '能力单项', moduleId: 4 },
];

const MODULE_TABLE_CONFIG = {
  moral: { label: '德育', rawKey: 'moralFinal', weightedKey: 'moralWeighted', weightKey: 'moralWeight' },
  intellectual: { label: '智育', rawKey: 'intellectualFinal', weightedKey: 'intellectualWeighted', weightKey: 'intellectualWeight' },
  physical: { label: '体育', rawKey: 'physicalFinal', weightedKey: 'physicalWeighted', weightKey: 'physicalWeight' },
  ability: { label: '能力', rawKey: 'abilityFinal', weightedKey: 'abilityWeighted', weightKey: 'abilityWeight' },
  aesthetics: { label: '美育', rawKey: 'aestheticsFinal', weightedKey: 'aestheticsWeighted', weightKey: 'aestheticsWeight' },
  labor: { label: '劳动', rawKey: 'laborFinal', weightedKey: 'laborWeighted', weightKey: 'laborWeight' },
} as const;

export const ExportCenter: React.FC<ExportCenterProps> = ({
  summaries,
  activeAcademicYear,
  currentUser
}) => {
  const [selectedClassKey, setSelectedClassKey] = useState<string>('all');
  const [selectedGrade, setSelectedGrade] = useState<string>('all');
  const [selectedProject, setSelectedProject] = useState<string>('comprehensive');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [checkingProofs, setCheckingProofs] = useState(false);
  const [cleaningProofs, setCleaningProofs] = useState(false);
  const [proofCheck, setProofCheck] = useState<any>(null);
  const [managedClasses, setManagedClasses] = useState<string[]>([]);
  const [managedGrade, setManagedGrade] = useState('');
  const [managedClassesLoaded, setManagedClassesLoaded] = useState(false);

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'college_admin';
  const availableClassOptions = useMemo(() => {
    const map = new Map<string, ExportClassOption>();
    const addOption = (className: string, grade: string) => {
      const cleanClassName = String(className || '').trim();
      if (!cleanClassName) return;
      const cleanGrade = resolveStudentGrade(grade, cleanClassName);
      const key = classScopeKey(cleanClassName, cleanGrade);
      if (map.has(key)) return;
      const gradeCount = new Set(
        summaries
          .filter(item => normalizeClassName(item.majorClass) === normalizeClassName(cleanClassName))
          .map(item => resolveStudentGrade(item.grade, item.majorClass, item.studentId))
          .filter(Boolean)
      ).size;
      const label = cleanGrade && (isAdmin || gradeCount > 1 || managedClasses.length > 1)
        ? `${cleanGrade} ${cleanClassName}`
        : cleanClassName;
      map.set(key, { key, className: cleanClassName, grade: cleanGrade, label });
    };

    if (isAdmin) {
      summaries.forEach(item => addOption(item.majorClass, item.grade));
    } else {
      const scopeGrade = managedGrade;
      if (managedClasses.length > 0) {
        managedClasses.forEach(className => {
          const matches = summaries.filter(item => sameClassScope(
            item.majorClass,
            item.grade,
            className,
            scopeGrade,
            item.studentId,
          ));
          if (matches.length > 0) {
            matches.forEach(item => addOption(item.majorClass, item.grade));
          } else {
            addOption(className, scopeGrade);
          }
        });
      } else {
        summaries.forEach(item => addOption(item.majorClass, item.grade));
      }
    }
    return Array.from(map.values());
  }, [isAdmin, managedClasses, managedGrade, summaries]);

  const selectedClassOption = useMemo(
    () => availableClassOptions.find(item => item.key === selectedClassKey) || null,
    [availableClassOptions, selectedClassKey]
  );

  const availableGrades = useMemo(
    () => Array.from(new Set(summaries.map(s => s.grade).filter(Boolean))),
    [summaries]
  );

  useEffect(() => {
    if (isAdmin) return;
    let cancelled = false;
    setManagedClassesLoaded(false);
    apiService.fetchCounselorOverview(activeAcademicYear)
      .then(result => {
        if (!cancelled) {
          setManagedClasses((result.classNames || []).filter(Boolean));
          setManagedGrade(String(result.grade || result.configuredGrade || result.inferredGrade || '').trim());
        }
      })
      .catch(() => {
        if (!cancelled) {
          setManagedClasses([]);
          setManagedGrade('');
        }
      })
      .finally(() => {
        if (!cancelled) setManagedClassesLoaded(true);
      });
    return () => { cancelled = true; };
  }, [activeAcademicYear, isAdmin]);

  useEffect(() => {
    const selectionExists = selectedClassKey === 'all' || availableClassOptions.some(option => option.key === selectedClassKey);
    if (!selectionExists) setSelectedClassKey(isAdmin ? 'all' : (availableClassOptions[0]?.key || 'all'));
    else if (!isAdmin && selectedClassKey === 'all' && availableClassOptions[0]) setSelectedClassKey(availableClassOptions[0].key);
  }, [isAdmin, selectedClassKey, availableClassOptions]);

  const scopedSummaries = summaries.filter(s => {
    const matchesClass = selectedClassKey === 'all' || (
      selectedClassOption
        ? sameClassScope(
            s.majorClass,
            s.grade,
            selectedClassOption.className,
            selectedClassOption.grade,
            s.studentId,
          )
        : true
    );
    const matchesGrade = selectedGrade === 'all' || resolveStudentGrade(s.grade, s.majorClass, s.studentId) === normalizeGrade(selectedGrade);
    return matchesClass && matchesGrade;
  });

  const rankedScopedSummaries = useMemo(() => {
    const moduleConfig = MODULE_TABLE_CONFIG[selectedProject as keyof typeof MODULE_TABLE_CONFIG];
    const scoreOf = (item: StudentScoreSummary) => moduleConfig
      ? Number(item[moduleConfig.rawKey] || 0)
      : Number(item.totalScore || 0);
    const groups = new Map<string, StudentScoreSummary[]>();
    scopedSummaries.forEach(item => {
      const key = classScopeKey(item.majorClass, item.grade, item.studentId);
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    });

    const ranked: RankedDisplaySummary[] = [];
    Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
      .forEach(([, group]) => {
        const sorted = [...group].sort((a, b) =>
          scoreOf(b) - scoreOf(a) ||
          String(a.studentId).localeCompare(String(b.studentId), 'zh-Hans-CN', { numeric: true })
        );
        let previousScore: number | null = null;
        let currentRank = 0;
        sorted.forEach(item => {
          const score = scoreOf(item);
          if (previousScore === null || score !== previousScore) {
            currentRank += 1;
            previousScore = score;
          }
          ranked.push({
            ...item,
            classRank: currentRank,
            classTotal: sorted.length,
            displayRank: currentRank,
            displayScore: score,
            displayWeighted: moduleConfig ? Number(item[moduleConfig.weightedKey] || 0) : null,
            displayModule: moduleConfig?.label || null,
            displayWeight: moduleConfig ? Number(item[moduleConfig.weightKey] || 0) : null,
          });
        });
      });
    return ranked;
  }, [scopedSummaries, selectedProject]);

  const rankedFilteredSummaries = useMemo(() => {
    const keyword = searchQuery.trim();
    if (!keyword) return rankedScopedSummaries;
    return rankedScopedSummaries.filter(item =>
      item.studentName.includes(keyword) || item.studentId.includes(keyword)
    );
  }, [rankedScopedSummaries, searchQuery]);

  const selectedModuleConfig = MODULE_TABLE_CONFIG[selectedProject as keyof typeof MODULE_TABLE_CONFIG];

  const scoreText = (value: unknown) => String(Number(value || 0));

  const handleExportExcel = () => {
    const className = selectedClassOption?.className || '';
    const classGrade = selectedClassOption?.grade || '';
    if (!isAdmin && !className) return alert('未找到可导出的负责班级');
    const root = (currentUser.role === 'admin' || currentUser.role === 'college_admin') ? '/admin' : currentUser.role === 'assistant' ? '/assistant' : '/counselor';
    const project = EXPORT_PROJECTS.find(item => item.value === selectedProject) || EXPORT_PROJECTS[0];
    const params = new URLSearchParams();
    params.set('format', 'xlsx');
    params.set('yearId', activeAcademicYear);
    if (className) params.set('className', className);
    if (classGrade) params.set('grade', classGrade);
    if (isAdmin && selectedClassKey === 'all' && selectedGrade !== 'all') params.set('grade', selectedGrade);
    if (!isAdmin && selectedGrade !== 'all' && selectedGrade !== classGrade) params.set('grade', selectedGrade);

    if (project.moduleId) params.set('moduleId', String(project.moduleId));
    const path = root === '/assistant'
      ? `/assistant/export/score-table?${params.toString()}`
      : `${root}/export/score-table?${params.toString()}`;
    const scope = selectedClassOption?.label || (isAdmin && selectedGrade !== 'all' ? selectedGrade : '综合');
    const filename = project.moduleId
      ? `${activeAcademicYear}_${scope}_${project.label}成绩表.xlsx`
      : `${activeAcademicYear}_${scope}_综测登分表.xlsx`;
    apiService.download(path, filename).catch(error => alert(error.message));
  };

  const handleExportProofImages = () => {
    const className = selectedClassOption?.className || '';
    const classGrade = selectedClassOption?.grade || '';
    const grade = isAdmin && selectedGrade !== 'all' ? selectedGrade : '';
    const root = (currentUser.role === 'admin' || currentUser.role === 'college_admin') ? '/admin' : currentUser.role === 'assistant' ? '/assistant' : '/counselor';
    const params = new URLSearchParams();
    params.set('yearId', activeAcademicYear);
    if (className) params.set('className', className);
    if (classGrade) params.set('grade', classGrade);
    if (grade) params.set('grade', grade);
    const scope = selectedClassOption?.label || grade || (currentUser.role === 'assistant' ? '本班' : '全部');
    apiService.download(`${root}/export/proofs?${params.toString()}`, `${activeAcademicYear}_${scope}_证明图片.zip`).catch(error => alert(error.message));
  };

  const handleCheckProofFiles = async () => {
    setCheckingProofs(true);
    try {
      setProofCheck(await apiService.checkProofFiles(activeAcademicYear));
    } catch (error: any) {
      alert(error.message || '检查失败');
    } finally {
      setCheckingProofs(false);
    }
  };

  const handleCleanupOrphans = async () => {
    const orphans: string[] = proofCheck?.orphanFiles || [];
    if (orphans.length === 0) return;
    if (!window.confirm(`将物理删除 ${orphans.length} 张孤立图片（数据库已无对应材料记录）。删除后不可恢复，确定继续吗？`)) return;
    setCleaningProofs(true);
    try {
      const result = await apiService.cleanupProofOrphans(orphans);
      alert(`清理完成：成功删除 ${result.deletedCount} 张，失败/跳过 ${result.failedCount} 张`);
      setProofCheck(await apiService.checkProofFiles(activeAcademicYear));
    } catch (error: any) {
      alert(error.message || '清理失败');
    } finally {
      setCleaningProofs(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Top Banner */}
      <div className="surface-elevated rounded-2xl p-4 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-start gap-2 text-lg font-bold text-slate-900 dark:text-white sm:items-center">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              <span className="min-w-0">{isAdmin ? '全院 / 各年级 / 各班级综测成绩分板块导出中心' : '负责班级综测成绩导出中心'}</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {isAdmin
                ? '按年级、专业班级及测评板块灵活筛选并导出标准 Excel 报表。'
                : '辅导员只能导出自己负责班级的成绩和证明材料。'}
            </p>
          </div>

          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:w-auto lg:flex-wrap lg:items-center lg:justify-end shrink-0">
            <button
              onClick={handleExportExcel}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-amber-500/20 transition-all hover:bg-amber-600 lg:w-auto cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{selectedProject === 'comprehensive' ? '导出综合登分表 (.xlsx)' : '导出单项成绩表 (.xlsx)'}</span>
            </button>
            <button
              onClick={handleExportProofImages}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-blue-600/20 transition-all hover:bg-blue-700 lg:w-auto cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>导出证明图片包 (.zip)</span>
            </button>
            {currentUser.role === 'admin' && (
              <button
                onClick={handleCheckProofFiles}
                disabled={checkingProofs}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-600/20 transition-all hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 lg:w-auto cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{checkingProofs ? '检查中...' : '检查图片一致性'}</span>
              </button>
            )}
          </div>
        </div>

        {proofCheck && currentUser.role === 'admin' && (
          <div className={`mt-4 rounded-xl border px-4 py-3 text-xs ${
            proofCheck.missingCount || proofCheck.invalidPathCount || proofCheck.orphanFileCount
              ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300'
              : 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300'
          }`}>
            <div className="font-bold mb-1">
              图片一致性：数据库 {proofCheck.dbFileCount} 条，目录图片 {proofCheck.storedFileCount} 张，正常 {proofCheck.okCount} 条
            </div>
            <div>
              缺失文件 {proofCheck.missingCount} 条，非法路径 {proofCheck.invalidPathCount} 条，目录孤立图片 {proofCheck.orphanFileCount} 张
            </div>
            {(proofCheck.missingCount > 0 || proofCheck.invalidPathCount > 0 || proofCheck.orphanFileCount > 0) && (
              <div className="mt-2 space-y-1">
                {proofCheck.missing?.slice(0, 3).map((item: any) => (
                  <div key={`m-${item.id}`} className="break-all">缺失：{item.student_id} {item.student_name} - {item.proof_path}</div>
                ))}
                {proofCheck.orphanFiles?.slice(0, 3).map((item: string) => (
                  <div key={`o-${item}`} className="break-all">孤立：{item}</div>
                ))}
                {(proofCheck.missingCount > 3 || proofCheck.orphanFileCount > 3) && (
                  <div className="text-[10px] opacity-70">仅显示前 3 条，完整清单请以导出证明图片包核对。</div>
                )}
                {proofCheck.orphanFileCount > 0 && (
                  <button
                    onClick={handleCleanupOrphans}
                    disabled={cleaningProofs}
                    className="mt-2 flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{cleaningProofs ? '清理中...' : `删除 ${proofCheck.orphanFileCount} 张孤立图片`}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="mt-4 grid gap-3 text-xs lg:flex lg:items-center lg:justify-between">
          <div className="grid gap-2 flex-1 min-w-0 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="搜索学生姓名或学号..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
              />
            </div>

            {isAdmin && <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-slate-500 text-[11px]">年级:</span>
              <select
                value={selectedGrade}
                onChange={e => setSelectedGrade(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
              >
                <option value="all">所有年级</option>
                {availableGrades.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>}

            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-slate-500 text-[11px]">班级:</span>
              <select
                value={selectedClassKey}
                onChange={e => setSelectedClassKey(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-blue-600 dark:text-blue-400"
              >
                {isAdmin && <option value="all">所有专业班级</option>}
                {!isAdmin && selectedClassKey === 'all' && (
                  <option value="all">{managedClassesLoaded ? '未配置负责班级' : '加载负责班级中...'}</option>
                )}
                {!isAdmin && managedClasses.length === 0 && selectedClassKey !== 'all' && (
                  <option value={selectedClassKey}>{selectedClassOption?.label || '未配置负责班级'}</option>
                )}
                {availableClassOptions.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-slate-500 text-[11px]">导出项目:</span>
              <select
                value={selectedProject}
                onChange={e => setSelectedProject(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
              >
                {EXPORT_PROJECTS.map(project => (
                  <option key={project.value} value={project.value}>{project.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-slate-400 font-semibold text-left lg:text-right shrink-0">
            已检索到 <span className="text-amber-600 font-bold">{rankedFilteredSummaries.length}</span> 名学生
          </div>
        </div>
      </div>

      {/* Main Score & Rank Table */}
      <div className="surface-elevated rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`w-full text-left text-xs ${selectedModuleConfig ? 'min-w-[680px]' : 'min-w-[920px]'}`}>
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-800 uppercase">
              <tr>
                <th className="px-3 py-3 text-center">{selectedModuleConfig ? '单项班级排名' : '班级总分排名'}</th>
                <th className="px-4 py-3">学号</th>
                <th className="px-4 py-3">姓名</th>
                <th className="px-3 py-3">班级</th>
                {selectedModuleConfig ? (
                  <>
                    <th className="px-3 py-3 text-center">{selectedModuleConfig.label}合计分</th>
                    <th className="px-3 py-3 text-center">{selectedModuleConfig.label}折算分</th>
                    <th className="px-3 py-3 text-center">权重</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-3 text-center">德育(20%)</th>
                    <th className="px-3 py-3 text-center">智育(40%)</th>
                    <th className="px-3 py-3 text-center">体育(10%)</th>
                    <th className="px-3 py-3 text-center">能力(10%)</th>
                    <th className="px-3 py-3 text-center">美育(10%)</th>
                    <th className="px-3 py-3 text-center">劳动(10%)</th>
                    <th className="px-4 py-3 text-right">综测总分</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rankedFilteredSummaries.length === 0 ? (
                <tr>
                  <td colSpan={selectedModuleConfig ? 7 : 11} className="px-4 py-8 text-center text-slate-400">
                    没有符合筛选条件的学生记录
                  </td>
                </tr>
              ) : (
                rankedFilteredSummaries.map(item => (
                  <tr key={item.studentId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full font-mono font-bold text-[11px] ${
                        item.classRank === 1 ? 'bg-amber-500 text-white shadow-sm' :
                        item.classRank === 2 ? 'bg-slate-300 text-slate-800' :
                        item.classRank === 3 ? 'bg-amber-700 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600'
                      }`}>
                        {item.displayRank || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-white">
                      {item.studentId}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                      {item.studentName}
                    </td>
                    <td className="px-3 py-3 text-slate-500">
                      {selectedClassKey === 'all' ? `${item.grade} ${item.majorClass}` : item.majorClass}
                    </td>
                    {selectedModuleConfig ? (
                      <>
                        <td className="px-3 py-3 text-center font-mono">
                          {scoreText(item.displayScore)}
                        </td>
                        <td className="px-3 py-3 text-center font-mono">
                          {scoreText(item.displayWeighted)}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-slate-500">
                          {scoreText(item.displayWeight)}%
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-3 text-center font-mono">{scoreText(item.moralWeighted)}</td>
                        <td className="px-3 py-3 text-center font-mono">{scoreText(item.intellectualWeighted)}</td>
                        <td className="px-3 py-3 text-center font-mono">{scoreText(item.physicalWeighted)}</td>
                        <td className="px-3 py-3 text-center font-mono">{scoreText(item.abilityWeighted)}</td>
                        <td className="px-3 py-3 text-center font-mono">{scoreText(item.aestheticsWeighted)}</td>
                        <td className="px-3 py-3 text-center font-mono">{scoreText(item.laborWeighted)}</td>
                        <td className="px-4 py-3 text-right font-bold text-amber-600 dark:text-amber-400 font-mono text-sm">{item.totalScore} 分</td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
