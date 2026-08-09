import React, { useMemo, useState } from 'react';
import { RuleCategoryConfig, StudentRecord, User } from '../../types';
import { parseExcelFile, downloadScoreImportTemplate } from '../../utils/excel';
import { apiService } from '../../services/api';
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';

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
}

function isExampleImportRow(row: Record<string, unknown>) {
  return Object.values(row).some(value => /^示例[:：]/.test(String(value || '').trim()));
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
      .filter(item => !item.requiresProof && config.moduleId)
      .map(item => ({ ...item, moduleId: Number(config.moduleId), moduleName: config.categoryName }))
  ).sort((left, right) => {
    const moduleOrder: Record<string, number> = { moral: 1, intellectual: 2, physical: 3, ability: 4, aesthetics: 5, labor: 6 };
    return (moduleOrder[left.category] || 99) - (moduleOrder[right.category] || 99) || left.name.localeCompare(right.name, 'zh-CN');
  }), [ruleConfigs]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [parsedItems, setParsedItems] = useState<ParsedScore[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const selectedItem = importableItems.find(item => String(item.id) === selectedItemId) || importableItems[0];
  const isAdmin = currentUser.role === 'admin';
  const matchedCount = parsedItems.filter(item => item.matchFound).length;
  const invalidCount = parsedItems.length - matchedCount;

  const readScore = (row: Record<string, unknown>) => {
    const candidates = [
      row['成绩'], row['score'], row['分数'], row['基础成绩'],
      selectedItem?.moduleName ? row[`${selectedItem.moduleName}成绩`] : undefined,
      selectedItem?.moduleName ? row[selectedItem.moduleName] : undefined,
      selectedItem?.name ? row[selectedItem.name] : undefined,
      row['智育百分制'], row['德育基础分(0-100)'], row['德育基础分'], row['体育/体测成绩(0-100)'], row['体育成绩']
    ];
    const raw = candidates.find(value => value !== undefined && value !== null && String(value).trim() !== '');
    return Number(raw);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!selectedItem) return alert('当前没有可导入的基础成绩项目，请先由管理员在计分规则中配置“不需要材料审核”的项目。');

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
          const studentId = String(row['学号'] || row['studentId'] || row['学生学号'] || '').trim();
          const student = students.find(item => item.studentId === studentId);
          return {
            studentId,
            studentName: String(row['姓名'] || row['studentName'] || student?.name || '未知学生').trim(),
            score: readScore(row),
            matchFound: Boolean(student)
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

  const handleApplyScores = async () => {
    if (!selectedItem || parsedItems.length === 0 || isImporting) return;
    if (invalidCount > 0) return alert(`有 ${invalidCount} 条记录未匹配到当前可管理范围内的学生，请修正后再导入。`);
    if (parsedItems.some(item => !Number.isFinite(item.score))) return alert('存在无法识别的成绩，请确认成绩列为数字。');
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

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><FileSpreadsheet className="h-5 w-5 text-blue-600" /><span className="min-w-0">基础成绩批量导入</span></h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {isAdmin ? '管理员可导入任意学生的基础成绩。' : '仅可导入本人负责年级、班级内学生的基础成绩。'} 导入成功后自动参与综测汇总与排名。
            </p>
          </div>
          <button onClick={() => downloadScoreImportTemplate(selectedItem?.category === 'moral' ? 'moral' : selectedItem?.category === 'physical' ? 'physical' : 'intellectual')} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 md:w-auto"><Download className="h-3.5 w-3.5" /><span>下载导入模板</span></button>
        </div>

        {importableItems.length === 0 ? (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />当前评分规则没有可由 Excel 导入的项目。管理员请在“计分规则配置”中为目标板块新增或调整一个“不需要材料审核”的项目。</div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select value={selectedItemId || String(selectedItem?.id || '')} onChange={event => { setSelectedItemId(event.target.value); setParsedItems([]); setSuccessMessage(''); }} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              {importableItems.map(item => <option key={item.id} value={item.id}>{item.moduleName} · {item.name}（0 - {item.maxScore} 分）</option>)}
            </select>
            <span className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-center text-xs font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">当前学年：{activeAcademicYear}</span>
          </div>
        )}
      </div>

      {importableItems.length > 0 && <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center transition-colors hover:border-blue-500 dark:border-slate-700">
          <Upload className="mx-auto mb-3 h-8 w-8 text-blue-500" />
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">上传 Excel / CSV 成绩表</h3>
          <p className="mx-auto mt-1 max-w-xl text-xs text-slate-400">表格必须包含“学号”和成绩列。成绩列可命名为“成绩”、“{selectedItem?.moduleName}成绩”或“{selectedItem?.name}”。</p>
          <label className="mt-4 inline-flex cursor-pointer items-center rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700"><span>选择成绩文件（.xlsx / .xls / .csv）</span><input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} className="hidden" /></label>
        </div>

        {successMessage && <div className="mt-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /><span className="min-w-0">{successMessage}</span></div>}

        {parsedItems.length > 0 && <div className="mt-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">共 {parsedItems.length} 条，<span className="font-semibold text-emerald-600">{matchedCount} 条匹配</span>{invalidCount > 0 && <span className="font-semibold text-rose-600">，{invalidCount} 条不可导入</span>}</div><button onClick={handleApplyScores} disabled={isImporting || invalidCount > 0} className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto"><RefreshCw className={isImporting ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} /><span>{isImporting ? '正在写入数据库...' : '确认导入并更新排名'}</span></button></div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800"><table className="w-full min-w-[600px] text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-4 py-2.5">状态</th><th className="px-4 py-2.5">学号</th><th className="px-4 py-2.5">姓名</th><th className="px-4 py-2.5">导入项目</th><th className="px-4 py-2.5">成绩</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{parsedItems.map((item, index) => <tr key={`${item.studentId}-${index}`}><td className="px-4 py-2.5"><span className={item.matchFound ? 'text-emerald-600' : 'text-rose-600'}>{item.matchFound ? '匹配成功' : '不在可导入范围'}</span></td><td className="px-4 py-2.5 font-mono font-semibold">{item.studentId}</td><td className="px-4 py-2.5">{item.studentName}</td><td className="px-4 py-2.5 text-slate-500">{selectedItem?.moduleName} · {selectedItem?.name}</td><td className="px-4 py-2.5 font-mono font-bold text-blue-600">{Number.isFinite(item.score) ? item.score : '无效成绩'}</td></tr>)}</tbody></table></div>
        </div>}
      </div>}
    </div>
  );
};
