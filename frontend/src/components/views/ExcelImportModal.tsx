import React, { useMemo, useState } from 'react';
import { RuleCategoryConfig, StudentRecord, User } from '../../types';
import { calculatePhysicalBaseScore, downloadMoralDeductionImportTemplate, downloadScoreImportTemplate, parseExcelFile } from '../../utils/excel';
import { apiService } from '../../services/api';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, ShieldMinus, Upload } from 'lucide-react';

interface ExcelImportModalProps {
  students: StudentRecord[];
  ruleConfigs: RuleCategoryConfig[];
  activeAcademicYear: string;
  currentUser: User;
  onImported: () => void;
}

interface ParsedScore {
  studentId: string;
  studentName: string;
  score: number;
  matchFound: boolean;
  reason?: string;
}

interface ParsedDeduction {
  studentId: string;
  studentName: string;
  itemId: string;
  itemName: string;
  count?: number;
  score?: number;
  calculatedScore: number;
  matchFound: boolean;
  reason?: string;
}

function isExampleImportRow(row: Record<string, unknown>) {
  return Object.values(row).some(value => /^示例[:：]/.test(String(value || '').trim()));
}

function readText(row: Record<string, unknown>, keys: string[]) {
  const value = keys.map(key => row[key]).find(item => item !== undefined && item !== null && String(item).trim() !== '');
  return String(value || '').trim();
}

function readNumber(row: Record<string, unknown>, keys: string[]) {
  const raw = keys.map(key => row[key]).find(item => item !== undefined && item !== null && String(item).trim() !== '');
  return raw === undefined ? Number.NaN : Number(raw);
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({
  students,
  ruleConfigs,
  activeAcademicYear,
  currentUser,
  onImported
}) => {
  const importableItems = useMemo(() => ruleConfigs.flatMap(config =>
    config.items
      .filter(item => !item.requiresProof && config.moduleId && (config.category === 'intellectual' || config.category === 'physical'))
      .map(item => ({ ...item, moduleId: Number(config.moduleId), moduleName: config.categoryName }))
  ).sort((left, right) => left.moduleId - right.moduleId || left.name.localeCompare(right.name, 'zh-CN')), [ruleConfigs]);

  const moralDeductionItems = useMemo(() => ruleConfigs.flatMap(config =>
    config.category === 'moral'
      ? config.items
        .filter(item => !item.requiresProof && item.maxScore < 0)
        .map(item => ({ ...item, moduleId: Number(config.moduleId), moduleName: config.categoryName }))
      : []
  ).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')), [ruleConfigs]);

  const [selectedItemId, setSelectedItemId] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedScore[]>([]);
  const [parsedDeductions, setParsedDeductions] = useState<ParsedDeduction[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeductionImporting, setIsDeductionImporting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [deductionMessage, setDeductionMessage] = useState('');

  const selectedItem = importableItems.find(item => String(item.id) === selectedItemId) || importableItems[0];
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'college_admin';
  const matchedCount = parsedItems.filter(item => item.matchFound && Number.isFinite(item.score)).length;
  const invalidCount = parsedItems.length - matchedCount;
  const deductionMatchedCount = parsedDeductions.filter(item => item.matchFound && Number.isFinite(item.calculatedScore)).length;
  const deductionInvalidCount = parsedDeductions.length - deductionMatchedCount;
  const deductionTotal = parsedDeductions
    .filter(item => item.matchFound && Number.isFinite(item.calculatedScore))
    .reduce((sum, item) => sum + item.calculatedScore, 0);

  const readScore = (row: Record<string, unknown>) => {
    if (selectedItem?.category === 'physical') {
      const direct = readNumber(row, ['体育基础分', '体育基础成绩', '体育素质基础分', '成绩', 'score', '分数', '基础成绩']);
      if (Number.isFinite(direct)) return direct;
      return calculatePhysicalBaseScore(
        readText(row, ['第一学期体育成绩', '上学期体育成绩', '体育成绩1', '体育成绩（一）']),
        readText(row, ['第二学期体育成绩', '下学期体育成绩', '体育成绩2', '体育成绩（二）']),
        readText(row, ['体测成绩', '体质健康测试', '体质测试成绩', '国家学生体质健康测试'])
      );
    }
    return readNumber(row, [
      '智育百分制', '学业成绩（加权平均分）', '学业成绩', '成绩', 'score', '分数', '基础成绩',
      selectedItem?.moduleName ? `${selectedItem.moduleName}成绩` : '',
      selectedItem?.moduleName || '',
      selectedItem?.name || ''
    ].filter(Boolean));
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!selectedItem) return alert('当前没有可导入的智育/体育基础成绩项目，请先由管理员在计分规则中配置“不需要材料审核”的项目。');

    try {
      const rows = await parseExcelFile<Record<string, unknown>>(file);
      let exampleRows = 0;
      const rowsForImport = rows.filter(row => {
        if (isExampleImportRow(row)) {
          exampleRows += 1;
          return false;
        }
        return true;
      });
      const maxScore = selectedItem.category === 'physical' ? Math.min(Number(selectedItem.maxScore) || 60, 60) : Number(selectedItem.maxScore);
      const items = rowsForImport
        .map(row => {
          const studentId = readText(row, ['学号', 'studentId', '学生学号']);
          const student = students.find(item => item.studentId === studentId);
          const score = readScore(row);
          const validScore = Number.isFinite(score) && score >= 0 && score <= maxScore;
          return {
            studentId,
            studentName: readText(row, ['姓名', 'studentName']) || student?.name || '未知学生',
            score,
            matchFound: Boolean(student) && validScore,
            reason: !student ? '不在可导入范围' : !validScore ? `成绩应在 0-${maxScore} 之间` : undefined
          };
        })
        .filter(item => item.studentId);
      if (items.length === 0) {
        if (exampleRows > 0) return alert(`只读取到 ${exampleRows} 条模板示例行，已自动跳过。请删除“示例：”前缀并填写真实成绩后再导入。`);
        return alert('未读取到学号，请确认表头包含“学号”列。');
      }
      setParsedItems(items);
      setSuccessMessage(exampleRows > 0 ? `已自动跳过 ${exampleRows} 条模板示例行，读取到 ${items.length} 条待导入成绩。` : '');
    } catch (error: any) {
      alert(error?.message || '解析 Excel 文件失败，请确认文件格式和表头。');
    }
  };

  const handleDeductionUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (moralDeductionItems.length === 0) return alert('当前规则中没有可批量导入的德育扣分项。');

    try {
      const rows = await parseExcelFile<Record<string, unknown>>(file);
      let exampleRows = 0;
      const rowsForImport = rows.filter(row => {
        if (isExampleImportRow(row)) {
          exampleRows += 1;
          return false;
        }
        return true;
      });
      const items = rowsForImport
        .map(row => {
          const studentId = readText(row, ['学号', 'studentId', '学生学号']);
          const student = students.find(item => item.studentId === studentId);
          const itemIdText = readText(row, ['扣分项ID', '扣分项Id', 'itemId', '项目ID']);
          const itemNameText = readText(row, ['扣分项名称', '项目名称', '扣分项目']);
          const deductionItem = moralDeductionItems.find(item => String(item.id) === itemIdText)
            || moralDeductionItems.find(item => item.name === itemNameText);
          const count = readNumber(row, ['次数', 'count']);
          const rawScore = readNumber(row, ['扣分', '扣分值', 'score', '分数']);
          const calculatedScore = Number.isFinite(rawScore)
            ? -Math.abs(rawScore)
            : Number.isFinite(count) && deductionItem
            ? Number(deductionItem.maxScore) * count
            : Number.NaN;
          const valid = Boolean(student) && Boolean(deductionItem) && Number.isFinite(calculatedScore) && calculatedScore < 0;
          return {
            studentId,
            studentName: readText(row, ['姓名', 'studentName']) || student?.name || '未知学生',
            itemId: String(deductionItem?.id || itemIdText),
            itemName: deductionItem?.name || itemNameText || '未知扣分项',
            count: Number.isFinite(count) ? count : undefined,
            score: Number.isFinite(rawScore) ? rawScore : undefined,
            calculatedScore,
            matchFound: valid,
            reason: !student ? '不在可导入范围' : !deductionItem ? '扣分项未匹配' : !Number.isFinite(calculatedScore) ? '缺少次数或扣分值' : calculatedScore >= 0 ? '扣分必须大于 0' : undefined
          };
        })
        .filter(item => item.studentId);
      if (items.length === 0) {
        if (exampleRows > 0) return alert(`只读取到 ${exampleRows} 条模板示例行，已自动跳过。请删除“示例：”前缀并填写真实扣分后再导入。`);
        return alert('未读取到学号，请确认表头包含“学号”列。');
      }
      setParsedDeductions(items);
      setDeductionMessage(exampleRows > 0 ? `已自动跳过 ${exampleRows} 条模板示例行，读取到 ${items.length} 条待导入扣分。` : '');
    } catch (error: any) {
      alert(error?.message || '解析德育扣分表失败，请确认文件格式和表头。');
    }
  };

  const handleApplyScores = async () => {
    if (!selectedItem || parsedItems.length === 0 || isImporting) return;
    if (invalidCount > 0) return alert(`有 ${invalidCount} 条记录不可导入，请修正后再导入。`);
    if (!confirm(`确认将 ${parsedItems.length} 条“${selectedItem.moduleName} - ${selectedItem.name}”成绩写入 ${activeAcademicYear} 学年？重复导入会覆盖同一学生同一项目的原成绩。`)) return;

    setIsImporting(true);
    try {
      const result: any = await apiService.importScores(
        currentUser.role as 'admin' | 'counselor',
        parsedItems.map(item => ({ studentId: item.studentId, score: item.score })),
        String(selectedItem.moduleId),
        String(selectedItem.id),
        activeAcademicYear
      );
      setSuccessMessage(result.message || `已导入 ${parsedItems.length} 条成绩。`);
      onImported();
    } catch (error: any) {
      alert(error?.message || '成绩导入失败');
    } finally {
      setIsImporting(false);
    }
  };

  const handleApplyDeductions = async () => {
    if (parsedDeductions.length === 0 || isDeductionImporting) return;
    if (deductionInvalidCount > 0) return alert(`有 ${deductionInvalidCount} 条扣分记录不可导入，请修正后再导入。`);
    if (!confirm(`确认将 ${parsedDeductions.length} 条德育扣分写入 ${activeAcademicYear} 学年？同一学生同一扣分项会覆盖原扣分。合计扣 ${Math.abs(deductionTotal)} 分。`)) return;

    setIsDeductionImporting(true);
    try {
      const result: any = await apiService.importMoralDeductions(
        currentUser.role as 'admin' | 'counselor',
        parsedDeductions.map(item => ({ studentId: item.studentId, itemId: item.itemId, count: item.count, score: item.score })),
        activeAcademicYear
      );
      setDeductionMessage(result.message || `已导入 ${parsedDeductions.length} 条德育扣分。`);
      onImported();
    } catch (error: any) {
      alert(error?.message || '德育扣分导入失败');
    } finally {
      setIsDeductionImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><FileSpreadsheet className="h-5 w-5 text-blue-600" /><span className="min-w-0">智育/体育基础成绩批量导入</span></h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isAdmin ? '管理员可导入任意学生的智育和体育基础成绩。' : '仅可导入本人负责年级、班级内学生的智育和体育基础成绩。'} 德育扣分请使用下方独立入口。
            </p>
          </div>
          <button onClick={() => downloadScoreImportTemplate(selectedItem?.category === 'physical' ? 'physical' : 'intellectual')} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 md:w-auto"><Download className="h-3.5 w-3.5" /><span>下载当前模板</span></button>
        </div>

        {importableItems.length === 0 ? (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />当前评分规则没有可由 Excel 导入的智育/体育项目。管理员请先在“计分规则配置”中配置“不需要材料审核”的智育或体育项目。</div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select value={selectedItemId || String(selectedItem?.id || '')} onChange={event => { setSelectedItemId(event.target.value); setParsedItems([]); setSuccessMessage(''); }} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              {importableItems.map(item => <option key={item.id} value={item.id}>{item.moduleName} · {item.name}（0 - {item.category === 'physical' ? Math.min(item.maxScore, 60) : item.maxScore} 分）</option>)}
            </select>
            <span className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-center text-xs font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">当前学年：{activeAcademicYear}</span>
          </div>
        )}
      </div>

      {importableItems.length > 0 && <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center transition-colors hover:border-blue-500 dark:border-slate-700">
          <Upload className="mx-auto mb-3 h-8 w-8 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">上传智育/体育 Excel / CSV</h3>
          <p className="mx-auto mt-1 max-w-2xl text-xs text-slate-400">智育读取“智育百分制/成绩”；体育可读取“体育基础分”，也可按“第一学期体育成绩、第二学期体育成绩、体测成绩”自动换算，最高 60 分。</p>
          <label className="mt-4 inline-flex cursor-pointer items-center rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700"><span>选择成绩文件（.xlsx / .xls / .csv）</span><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" /></label>
        </div>

        {successMessage && <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /><span className="min-w-0">{successMessage}</span></div>}

        {parsedItems.length > 0 && <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">共 {parsedItems.length} 条，<span className="font-semibold text-emerald-600">{matchedCount} 条可导入</span>{invalidCount > 0 && <span className="font-semibold text-rose-600">，{invalidCount} 条需修正</span>}</div><button onClick={handleApplyScores} disabled={isImporting || invalidCount > 0} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"><RefreshCw className={isImporting ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /><span>{isImporting ? '正在写入数据库...' : '确认导入并更新排名'}</span></button></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full min-w-[680px] text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-2.5">状态</th><th className="px-4 py-2.5">学号</th><th className="px-4 py-2.5">姓名</th><th className="px-4 py-2.5">导入项目</th><th className="px-4 py-2.5">成绩</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{parsedItems.map((item, index) => <tr key={`${item.studentId}-${index}`}><td className="px-4 py-2.5"><span className={item.matchFound ? 'text-emerald-600' : 'text-rose-600'}>{item.matchFound ? '可导入' : item.reason}</span></td><td className="px-4 py-2.5 font-mono font-semibold">{item.studentId}</td><td className="px-4 py-2.5">{item.studentName}</td><td className="px-4 py-2.5 text-slate-500">{selectedItem?.moduleName} · {selectedItem?.name}</td><td className="px-4 py-2.5 font-mono font-bold text-blue-600">{Number.isFinite(item.score) ? item.score : '无法换算'}</td></tr>)}</tbody></table></div>
        </div>}
      </div>}

      <div className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm dark:border-rose-900/60 dark:bg-slate-900">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><ShieldMinus className="h-5 w-5 text-rose-600" /><span className="min-w-0">德育扣分批量导入统计</span></h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">用于处分、通报、宿舍卫生、班团活动缺勤等扣分项。导入后写入德育扣分，不走学生材料申报。</p>
          </div>
          <button onClick={() => downloadMoralDeductionImportTemplate(moralDeductionItems)} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 md:w-auto"><Download className="h-3.5 w-3.5" /><span>下载扣分模板</span></button>
        </div>

        {moralDeductionItems.length === 0 ? (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />当前没有可导入的德育扣分项，请检查规则中是否存在德育模块、负分、不需要材料审核的项目。</div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-2xl border-2 border-dashed border-rose-200 p-8 text-center transition-colors hover:border-rose-500 dark:border-rose-900/70">
              <Upload className="mx-auto mb-3 h-8 w-8 text-rose-500" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">上传德育扣分 Excel / CSV</h3>
              <p className="mx-auto mt-1 max-w-xl text-xs text-slate-400">表格包含“学号、扣分项ID、次数或扣分”。同一学生同一扣分项重复导入会覆盖该项目原扣分。</p>
              <label className="mt-4 inline-flex cursor-pointer items-center rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-rose-600/20 hover:bg-rose-700"><span>选择扣分文件</span><input type="file" accept=".xlsx,.xls,.csv" onChange={handleDeductionUpload} className="hidden" /></label>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-800 dark:bg-slate-950/40">
              <div className="font-bold text-slate-800 dark:text-slate-100">可导入扣分项</div>
              <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
                {moralDeductionItems.map(item => <div key={item.id} className="flex items-start justify-between gap-3 rounded-xl bg-white px-3 py-2 dark:bg-slate-900"><span className="min-w-0 text-slate-600 dark:text-slate-300">{item.name}</span><span className="shrink-0 font-mono font-bold text-rose-600">ID {item.id} / {item.maxScore}</span></div>)}
              </div>
            </div>
          </div>
        )}

        {deductionMessage && <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /><span className="min-w-0">{deductionMessage}</span></div>}

        {parsedDeductions.length > 0 && <div className="mt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800"><span className="block text-slate-400">待导入记录</span><b className="text-slate-900 dark:text-white">{parsedDeductions.length}</b></div>
            <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><span className="block">可导入</span><b>{deductionMatchedCount}</b></div>
            <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><span className="block">合计扣分</span><b>{Math.abs(deductionTotal)}</b></div>
          </div>
          <div className="flex justify-end"><button onClick={handleApplyDeductions} disabled={isDeductionImporting || deductionInvalidCount > 0} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-rose-600/20 hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"><RefreshCw className={isDeductionImporting ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /><span>{isDeductionImporting ? '正在写入扣分...' : '确认导入德育扣分'}</span></button></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-2.5">状态</th><th className="px-4 py-2.5">学号</th><th className="px-4 py-2.5">姓名</th><th className="px-4 py-2.5">扣分项</th><th className="px-4 py-2.5">次数</th><th className="px-4 py-2.5">扣分</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{parsedDeductions.map((item, index) => <tr key={`${item.studentId}-${item.itemId}-${index}`}><td className="px-4 py-2.5"><span className={item.matchFound ? 'text-emerald-600' : 'text-rose-600'}>{item.matchFound ? '可导入' : item.reason}</span></td><td className="px-4 py-2.5 font-mono font-semibold">{item.studentId}</td><td className="px-4 py-2.5">{item.studentName}</td><td className="px-4 py-2.5 text-slate-500">{item.itemName}</td><td className="px-4 py-2.5 font-mono">{item.count || '-'}</td><td className="px-4 py-2.5 font-mono font-bold text-rose-600">{Number.isFinite(item.calculatedScore) ? item.calculatedScore : '无效'}</td></tr>)}</tbody></table></div>
        </div>}
      </div>
    </div>
  );
};
