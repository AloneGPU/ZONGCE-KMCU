import React, { useState } from 'react';
import { AcademicYearConfig, User } from '../../types';
import { apiService } from '../../services/api';
import { Calendar, Plus, Lock, CheckCircle2, Archive } from 'lucide-react';

interface AcademicYearArchivingProps {
  academicYears: AcademicYearConfig[];
  activeAcademicYear: string;
  onSelectActiveYear: (year: string) => void;
  onUpdateAcademicYears: (years: AcademicYearConfig[]) => void;
  isAdmin: boolean;
  currentUser: User;
}

export const AcademicYearArchiving: React.FC<AcademicYearArchivingProps> = ({
  academicYears,
  activeAcademicYear,
  onSelectActiveYear,
  onUpdateAcademicYears,
  isAdmin,
  currentUser
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newYearName, setNewYearName] = useState('2027-2028');
  const [newDeadline, setNewDeadline] = useState('2028-09-30');
  const [savingDeadlineId, setSavingDeadlineId] = useState<number | null>(null);
  const [deadlineDrafts, setDeadlineDrafts] = useState<Record<number, string>>({});

  const handleDeadlineChange = async (item: AcademicYearConfig, deadline: string) => {
    if (!item.id || savingDeadlineId !== null) return;
    setSavingDeadlineId(item.id);
    try {
      await apiService.updateYearDeadline(currentUser.role as 'admin' | 'counselor', item.id, deadline);
      onUpdateAcademicYears(academicYears.map(year =>
        year.id === item.id ? { ...year, deadline: deadline || undefined } : year
      ));
      setDeadlineDrafts(current => {
        const next = { ...current };
        delete next[item.id as number];
        return next;
      });
    } catch (err: any) {
      alert(err?.message || '材料提交截止日更新失败');
    } finally {
      setSavingDeadlineId(null);
    }
  };

  const handleToggleLockYear = async (yearStr: string) => {
    if (!isAdmin) return;
    const target = academicYears.find(y => y.year === yearStr);
    if (!target || target.id === undefined) return;
    try {
      await apiService.toggleYearLock(target.id, !target.isLocked);
      onUpdateAcademicYears(academicYears.map(y =>
        y.year === yearStr ? { ...y, isLocked: !y.isLocked } : y
      ));
    } catch (err: any) {
      alert(err?.message || '锁定状态更新失败');
    }
  };

  const handleActivateYear = async (item: AcademicYearConfig) => {
    if (!isAdmin || item.id === undefined) {
      onSelectActiveYear(item.year);
      return;
    }
    try {
      await apiService.activateYear(item.id);
      onUpdateAcademicYears(academicYears.map(y => ({ ...y, isCurrent: y.year === item.year })));
      onSelectActiveYear(item.year);
    } catch (err: any) {
      alert(err?.message || '设置主学年失败');
    }
  };

  const handleAddAcademicYear = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newYearName) return;

    if (academicYears.some(y => y.year === newYearName)) {
      alert('该学年已存在！');
      return;
    }

    try {
      const { year } = await apiService.createYear(newYearName, newDeadline);
      onUpdateAcademicYears([
        ...academicYears,
        {
          id: Number(year.id),
          year: year.name || newYearName,
          isCurrent: false,
          isLocked: false,
          deadline: newDeadline || undefined
        }
      ]);
      setShowAddModal(false);
      setNewYearName('');
    } catch (err: any) {
      alert(err?.message || '新增学年失败');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-start gap-2 text-lg font-bold text-slate-900 dark:text-white sm:items-center">
              <Archive className="w-5 h-5 text-blue-600" />
              <span className="min-w-0">学年跨度管理与综测数据归档锁死</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              管理员可新增、切换和归档学年；管理员与辅导员均可自定义各学年的材料提交截止日。
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 md:w-auto shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>新增综测学年</span>
            </button>
          )}
        </div>
      </div>

      {/* Academic Years List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {academicYears.map(item => {
          const isActive = item.year === activeAcademicYear;
          return (
            <div
              key={item.year}
              className={`motion-lift p-6 rounded-2xl border transition-all flex flex-col justify-between relative overflow-hidden ${
                isActive
                  ? 'surface-elevated text-slate-900 dark:text-white border-blue-400 shadow-xl shadow-blue-600/10'
                  : 'bg-white/80 dark:bg-slate-900/80 text-slate-900 dark:text-white border-slate-200 dark:border-slate-800'
              }`}
            >
              <div>
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    <span className="min-w-0 truncate text-base font-bold">{item.year} 学年</span>
                  </div>

                  {item.isLocked && (
                    <span className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/20 px-2.5 py-1 text-[10px] font-bold text-rose-300">
                      <Lock className="w-3 h-3" />
                      <span>已被归档锁死</span>
                    </span>
                  )}
                </div>

                <div className="space-y-2 text-xs opacity-80 mb-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span>材料提交截止日:</span>
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <input
                        type="date"
                        value={item.id !== undefined && Object.prototype.hasOwnProperty.call(deadlineDrafts, item.id)
                          ? deadlineDrafts[item.id]
                          : item.deadline || ''}
                        onChange={event => item.id !== undefined && setDeadlineDrafts(current => ({
                          ...current,
                          [item.id as number]: event.target.value
                        }))}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white/70 px-2 py-1 font-mono text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200 sm:w-36 sm:flex-none"
                        aria-label={`${item.year}材料提交截止日`}
                      />
                      <button
                        type="button"
                        disabled={savingDeadlineId === item.id}
                        onClick={() => handleDeadlineChange(item, item.id !== undefined && Object.prototype.hasOwnProperty.call(deadlineDrafts, item.id)
                          ? deadlineDrafts[item.id]
                          : item.deadline || '')}
                        className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
                      >
                        {savingDeadlineId === item.id ? '保存中' : '保存'}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between">
                    <span>状态标识:</span>
                    <span>{isActive ? '当前处于主控测评状态' : '后台存量学年'}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-current/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
                {!isActive ? (
                  <button
                    onClick={() => handleActivateYear(item)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors ${
                      isActive
                        ? 'bg-white/10 text-white border-white/20'
                        : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-800/60 dark:text-blue-300 border-blue-200'
                    }`}
                  >
                    切换为主学年
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-blue-300">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>当前活跃主学年</span>
                  </span>
                )}

                {isAdmin && (
                  <button
                    onClick={() => handleToggleLockYear(item.year)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-xl border transition-colors ${
                      item.isLocked
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/30 hover:bg-rose-500/30'
                    }`}
                  >
                    {item.isLocked ? '解除归档锁定' : '锁死封存数据'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Academic Year Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">增加全新综测学年</h3>
            <form onSubmit={handleAddAcademicYear} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  学年名称
                </label>
                <input
                  type="text"
                  required
                  placeholder="如: 2027-2028"
                  value={newYearName}
                  onChange={e => setNewYearName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-semibold mb-1">
                  申报材料截止期限
                </label>
                <input
                  type="date"
                  value={newDeadline}
                  onChange={e => setNewDeadline(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white font-semibold rounded-xl"
                >
                  确定创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
