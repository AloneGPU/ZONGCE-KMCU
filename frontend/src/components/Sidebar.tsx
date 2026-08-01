import React from 'react';
import { UserRole } from '../types';
import {
  LayoutDashboard,
  Users,
  Settings,
  Archive,
  FileSpreadsheet,
  FileCheck2,
  Upload,
  FileText,
  Award,
  BookOpen,
  PieChart,
  X
} from 'lucide-react';

export type NavItemKey =
  | 'overview'
  | 'user-import'
  | 'rules-config'
  | 'archiving'
  | 'excel-import'
  | 'audit-center'
  | 'score-export'
  | 'my-materials'
  | 'rules-view'
  | 'pdf-export'
  | 'class-overview';

interface SidebarProps {
  role: UserRole;
  activeTab: NavItemKey;
  onTabChange: (tab: NavItemKey) => void;
  pendingCount?: number;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  role,
  activeTab,
  onTabChange,
  pendingCount = 0,
  isMobileOpen = false,
  onMobileClose
}) => {
  const getNavItems = (): Array<{ key: NavItemKey; label: string; icon: any; category?: string; badge?: number }> => {
    switch (role) {
      case 'admin':
        return [
          { key: 'overview', label: '数据系统概览', icon: LayoutDashboard, category: '管理控制' },
          { key: 'user-import', label: '用户与管理', icon: Users, category: '管理控制' },
          { key: 'rules-config', label: '计分规则配置', icon: Settings, category: '管理控制' },
          { key: 'excel-import', label: '基础成绩批量导入', icon: Upload, category: '管理控制' },
          { key: 'score-export', label: '全院综测成绩导出', icon: FileSpreadsheet, category: '报表中心' }
        ];

      case 'counselor':
        return [
          { key: 'overview', label: '年级综测看板', icon: PieChart, category: '管理控制' },
          { key: 'audit-center', label: '材料协同复核与终审', icon: FileCheck2, category: '管理控制', badge: pendingCount },
          { key: 'user-import', label: '学生与班级申请', icon: Users, category: '管理控制' },
          { key: 'excel-import', label: '负责班级成绩导入', icon: Upload, category: '管理控制' },
          { key: 'rules-view', label: '综测计分规则说明', icon: Settings, category: '规则细则' },
          { key: 'score-export', label: '班级综测汇总导出', icon: FileSpreadsheet, category: '报表中心' }
        ];

      case 'assistant':
        return [
          { key: 'overview', label: '我的综测成绩', icon: Award, category: '个人中心' },
          { key: 'my-materials', label: '个人加分材料申报', icon: FileText, category: '个人中心' },
          { key: 'pdf-export', label: '综测登记表 / PDF导出', icon: FileSpreadsheet, category: '个人中心' },
          { key: 'audit-center', label: '班级材料初审与核对', icon: FileCheck2, category: '班级管理', badge: pendingCount },
          { key: 'class-overview', label: '班级综测数据监察', icon: PieChart, category: '班级管理' },
          { key: 'rules-view', label: '综测计分规则说明', icon: BookOpen, category: '规则细则' }
        ];

      case 'student':
        return [
          { key: 'overview', label: '我的综测成绩看板', icon: Award, category: '个人中心' },
          { key: 'my-materials', label: '加分材料申报与管理', icon: FileText, category: '个人中心' },
          { key: 'rules-view', label: '综测计分规则说明', icon: BookOpen, category: '规则细则' },
          { key: 'pdf-export', label: '综测登记表 / PDF导出', icon: FileSpreadsheet, category: '报表导出' }
        ];

      default:
        return [];
    }
  };

  const items = getNavItems();
  const categories = Array.from(new Set(items.map(i => i.category || '导航菜单')));

  const renderNavContent = () => (
    <>
      <div className="flex flex-col flex-1 overflow-y-auto">
        {/* Brand Header */}
        <div className="sidebar-brand p-5 flex items-center justify-between text-white border-b border-white/8">
          <div className="flex items-center space-x-3">
            <div className="brand-glyph w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xl">
              综
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white block">综合素质管理</span>
              <span className="text-[10px] text-slate-400 font-semibold block">Evaluation OS</span>
            </div>
          </div>
          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="md:hidden p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Nav Items categorized */}
        <div className="flex-1 px-4 py-4 space-y-5">
          {categories.map(cat => {
            const catItems = items.filter(i => (i.category || '导航菜单') === cat);
            return (
              <div key={cat} className="space-y-1">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-1.5">
                  {cat}
                </div>
                {catItems.map(item => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        onTabChange(item.key);
                        if (onMobileClose) onMobileClose();
                      }}
                      className={`motion-lift relative w-full flex items-center justify-between px-3.5 py-3 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 active:scale-[0.98] ${
                        isActive
                          ? 'bg-teal-500/18 text-teal-100 border border-teal-300/25 shadow-sm'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                      }`}
                    >
                      {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-teal-300" />}
                      <div className="flex items-center space-x-3">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-teal-300' : 'text-slate-400'}`} />
                        <span>{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer System Status Panel */}
      <div className="p-4 bg-white/[0.04] border-t border-slate-800/80">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-200 font-bold">算法引擎运行中</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>
        <p className="text-[10px] text-slate-400 leading-tight">
          五模块动态权重比例演算与全员实时排名已开启。
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Persistent Sidebar */}
      <aside className="app-sidebar w-64 text-slate-300 flex-col justify-between shrink-0 hidden md:flex select-none">
        {renderNavContent()}
      </aside>

      {/* Mobile Responsive Slide-Over Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity"
            onClick={onMobileClose}
          />
          {/* Mobile Drawer Content */}
          <div className="app-sidebar relative w-4/5 max-w-xs text-slate-300 flex flex-col justify-between h-full shadow-2xl z-10 select-none">
            {renderNavContent()}
          </div>
        </div>
      )}
    </>
  );
};
