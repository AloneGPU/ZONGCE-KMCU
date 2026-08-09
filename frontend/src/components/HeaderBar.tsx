import React, { useState, useEffect, useRef } from 'react';
import { User, AcademicYearConfig } from '../types';
import type { ThemeAccent, ThemeMode } from '../theme';
import { THEME_ACCENTS } from '../theme';
import { apiService } from '../services/api';
import {
  Sparkles,
  Calendar,
  Lock,
  LockOpen,
  Bell,
  ChevronDown,
  LogOut,
  UserCheck,
  Shield,
  GraduationCap,
  Award,
  Server,
  Menu,
  Plus,
  X,
  Megaphone,
  Monitor,
  Moon,
  Sun,
  KeyRound,
  Palette
} from 'lucide-react';

interface HeaderBarProps {
  currentUser: User;
  onLogout: () => void;
  activeAcademicYear: string;
  onAcademicYearChange: (year: string) => void;
  academicYears: AcademicYearConfig[];
  rulesLocked: boolean;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  themeAccent: ThemeAccent;
  onThemeAccentChange: (accent: ThemeAccent) => void;
  onToggleMobileMenu?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  currentUser,
  onLogout,
  activeAcademicYear,
  onAcademicYearChange,
  academicYears,
  rulesLocked,
  themeMode,
  onThemeModeChange,
  themeAccent,
  onThemeAccentChange,
  onToggleMobileMenu
}) => {
  const headerRef = useRef<HTMLElement>(null);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showPostForm, setShowPostForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newVisibility, setNewVisibility] = useState('all');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordEmail, setPasswordEmail] = useState(currentUser.email || '');
  const [passwordCode, setPasswordCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [isSendingPasswordCode, setIsSendingPasswordCode] = useState(false);
  const [passwordCodeCooldown, setPasswordCodeCooldown] = useState(0);

  const canPost = currentUser.role === 'admin';
  const canChangePasswordWithEmail = currentUser.role === 'student' || currentUser.role === 'assistant' || currentUser.role === 'counselor';

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setShowRoleMenu(false);
        setShowNotifications(false);
        setShowPostForm(false);
        setShowThemeMenu(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowRoleMenu(false);
        setShowNotifications(false);
        setShowPostForm(false);
        setShowThemeMenu(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (passwordCodeCooldown <= 0) return;
    const timer = window.setTimeout(() => setPasswordCodeCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [passwordCodeCooldown]);

  const loadAnnouncements = async () => {
    try {
      const res: any = await apiService.fetchAnnouncements();
      setAnnouncements(res.announcements || []);
      setLoaded(true);
    } catch (e) { /* ignore */ }
  };

  const postAnnouncement = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    try {
      await apiService.createAnnouncement({ title: newTitle.trim(), content: newContent.trim(), visibility: newVisibility });
      setNewTitle(''); setNewContent(''); setShowPostForm(false);
      loadAnnouncements();
    } catch (e: any) { alert('发布失败: ' + (e.message || '')); }
  };

  const deleteAnnouncement = async (id: number) => {
    if (!confirm('确定删除此公告？')) return;
    try { await apiService.deleteAnnouncement(id); loadAnnouncements(); } catch (e) {}
  };

  const sendPasswordCode = async () => {
    setPasswordMessage('');
    if (!passwordEmail.trim()) {
      setPasswordMessage('请先填写绑定邮箱');
      return;
    }
    try {
      setIsSendingPasswordCode(true);
      await apiService.sendEmailCode({
        account: currentUser.username,
        email: passwordEmail.trim(),
        purpose: 'reset_password'
      });
      setPasswordCodeCooldown(60);
      setPasswordMessage('验证码已发送，请查看邮箱。');
    } catch (e: any) {
      setPasswordMessage(e.message || '验证码发送失败');
    } finally {
      setIsSendingPasswordCode(false);
    }
  };

  const submitPasswordChange = async () => {
    setPasswordMessage('');
    if (!passwordEmail.trim() || !passwordCode.trim() || !newPassword || !confirmPassword) {
      setPasswordMessage('请完整填写邮箱、验证码和新密码');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('两次输入的新密码不一致');
      return;
    }
    try {
      await apiService.resetPassword({
        account: currentUser.username,
        email: passwordEmail.trim(),
        code: passwordCode.trim(),
        newPassword
      });
      setPasswordMessage('密码已修改，请重新登录。');
      setTimeout(() => {
        setShowPasswordModal(false);
        onLogout();
      }, 700);
    } catch (e: any) {
      setPasswordMessage(e.message || '密码修改失败');
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return { label: '管理员', bg: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800', icon: Shield };
      case 'counselor':
        return { label: '辅导员', bg: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800', icon: UserCheck };
      case 'assistant':
        return { label: '学生助理', bg: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', icon: Award };
      default:
        return { label: '学生', bg: 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800', icon: GraduationCap };
    }
  };

  const activeBadge = getRoleBadge(currentUser.role);
  const RoleIcon = activeBadge.icon;
  const activeAccent = THEME_ACCENTS[themeAccent];
  const accentEntries = Object.entries(THEME_ACCENTS) as Array<[ThemeAccent, typeof THEME_ACCENTS[ThemeAccent]]>;
  const themeModeItems: Array<{ value: ThemeMode; label: string; icon: typeof Monitor }> = [
    { value: 'system', label: '跟随系统', icon: Monitor },
    { value: 'light', label: '浅色', icon: Sun },
    { value: 'dark', label: '深色', icon: Moon },
  ];

  const activeYearConfig = academicYears.find(y => y.year === activeAcademicYear);

  return (
    <header ref={headerRef} className="app-header sticky top-0 z-30 px-3 py-2 sm:px-6 sm:py-0 flex flex-wrap items-center justify-between gap-2 shrink-0 transition-all sm:min-h-16 md:flex-nowrap">
      {/* Left: Mobile Menu Toggle & Brand / Title */}
      <div className="flex items-center space-x-2 sm:space-x-3 min-w-0 shrink flex-1 md:flex-none">
        {onToggleMobileMenu && (
          <button
            onClick={onToggleMobileMenu}
            className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            title="打开功能导航菜单"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <h2 className="text-sm sm:text-base md:text-xl font-bold text-slate-800 dark:text-white tracking-tight truncate">
          综合测评系统
        </h2>
        <div className="hidden sm:flex px-2.5 py-1 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md text-slate-600 dark:text-slate-300 text-[11px] sm:text-xs font-semibold rounded-lg border border-slate-200/80 dark:border-slate-700/80 items-center shrink-0">
          <Calendar className="w-3.5 h-3.5 text-blue-600 mr-1" />
          <span>{activeAcademicYear}</span>
        </div>
      </div>

      {/* Center & Right Controls */}
      <div className="flex min-w-0 max-w-full items-center justify-end flex-wrap gap-1.5 sm:gap-3 ml-auto">
        {/* Academic Year Switcher Dropdown */}
        <div className="flex items-center space-x-1 bg-white/72 dark:bg-slate-900/72 backdrop-blur-md px-2 sm:px-3 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700/80 text-xs shadow-sm max-w-full">
          <span className="text-slate-500 dark:text-slate-400 font-medium hidden md:inline">学年:</span>
          {currentUser.role === 'admin' || currentUser.role === 'counselor' ? (
            <select
              value={activeAcademicYear}
              onChange={(e) => onAcademicYearChange(e.target.value)}
              className="bg-transparent text-xs font-bold text-blue-600 dark:text-blue-400 focus:outline-none cursor-pointer max-w-[95px] sm:max-w-none"
            >
              {academicYears.map(year => (
                <option key={year.year} value={year.year} className="text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900">
                  {year.year} {year.isLocked ? '(已归档)' : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300 px-1 max-w-[95px] sm:max-w-none truncate" title="学年由管理员/辅导员切换">{activeAcademicYear}</span>
          )}
          {activeYearConfig?.isLocked ? (
            <span className="hidden xs:flex items-center px-1.5 py-0.5 text-[10px] font-bold text-rose-600 bg-rose-50 dark:bg-rose-950/60 rounded border border-rose-200 dark:border-rose-900 ml-0.5 shrink-0">
              <Lock className="w-3 h-3 mr-0.5" /> <span className="whitespace-nowrap">封存</span>
            </span>
          ) : (
            <span className="hidden xs:flex items-center px-1.5 py-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 rounded border border-emerald-200 dark:border-emerald-900 ml-0.5 shrink-0">
              <LockOpen className="w-3 h-3 mr-0.5" /> <span className="whitespace-nowrap">申报中</span>
            </span>
          )}
        </div>

        {/* Backend Server Status */}
        <div className="hidden lg:flex items-center space-x-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 px-2.5 py-1.5 rounded-lg text-xs" title="测评系统服务正常运行">
          <Server className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="font-semibold text-[11px]">服务正常</span>
        </div>

        {/* Global Rules Locked Badge */}
        {rulesLocked && (
          <div className="hidden xl:flex items-center space-x-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900" title="管理员已锁死加分规则">
            <Lock className="w-3.5 h-3.5" />
            <span className="font-semibold text-[11px]">规则已锁死</span>
          </div>
        )}

        {/* Theme Switcher */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setShowRoleMenu(false);
              setShowNotifications(false);
              setShowPostForm(false);
              setShowThemeMenu(!showThemeMenu);
            }}
              className="motion-lift flex min-w-0 items-center gap-1.5 bg-white/72 dark:bg-slate-900/72 backdrop-blur-md px-2.5 py-2 rounded-lg border border-slate-200/80 dark:border-slate-700/80 text-xs shadow-sm"
            title="切换界面主题与主题色"
          >
            <Palette className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="hidden sm:inline font-bold text-slate-700 dark:text-slate-200">主题</span>
            <span
              className="h-3.5 w-3.5 rounded-full border border-white shadow-sm ring-1 ring-slate-300 dark:ring-slate-700"
              style={{ background: activeAccent.accent }}
            />
          </button>

          {showThemeMenu && (
            <div className="surface-elevated fixed right-3 top-16 mt-2 w-[calc(100vw-1.5rem)] max-w-xs rounded-xl p-3 z-50 text-xs sm:absolute sm:right-0 sm:top-auto sm:w-80">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Palette className="h-4 w-4 text-blue-600" />
                  <span>界面外观</span>
                </div>
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {activeAccent.label}
                </span>
              </div>

              <div className="mt-3 space-y-3">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">显示模式</div>
                    <span className="text-[10px] text-slate-400">浅色 / 深色 / 跟随系统</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {themeModeItems.map(item => {
                      const selected = themeMode === item.value;
                      const ModeIcon = item.icon;
                      return (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => onThemeModeChange(item.value)}
                          className={`flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-bold transition-all ${
                            selected
                              ? 'border-blue-300 bg-blue-50 text-slate-950 shadow-sm dark:border-blue-800 dark:bg-blue-950/40 dark:text-white'
                              : 'border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <ModeIcon className="h-3.5 w-3.5" />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">主题色</div>
                    <span className="text-[10px] text-slate-400">粉色 / 蓝色 / 紫色 / 琥珀 / 冰青</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {accentEntries.map(([key, preset]) => {
                      const selected = key === themeAccent;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onThemeAccentChange(key)}
                          className={`group flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition-all ${
                            selected
                              ? 'border-blue-300 bg-blue-50 text-slate-950 shadow-sm dark:border-blue-800 dark:bg-blue-950/40 dark:text-white'
                              : 'border-slate-200 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-700'
                          }`}
                          title={`切换为${preset.label}主题`}
                        >
                          <span
                            className="h-4 w-4 shrink-0 rounded-full border border-white shadow-sm ring-1 ring-black/10"
                            style={{ background: preset.accent }}
                          />
                          <span className="truncate text-[11px] font-bold">{preset.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Notification Bell */}
        <div className="relative">
          <button
            className="motion-lift p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors relative"
            title="系统消息通知"
            onClick={() => {
              setShowThemeMenu(false);
              setShowRoleMenu(false);
              setShowNotifications(!showNotifications);
              if (!loaded) loadAnnouncements();
            }}
          >
            <Bell className="w-4 h-4" />
            {announcements.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white dark:ring-slate-900" />}
          </button>

          {showNotifications && (
            <div className="surface-elevated fixed right-3 top-16 mt-2 w-[calc(100vw-1.5rem)] max-w-sm rounded-lg p-4 z-50 text-xs max-h-[calc(100dvh-5rem)] overflow-y-auto sm:absolute sm:right-0 sm:top-auto sm:w-80">
              <div className="font-bold text-slate-900 dark:text-white mb-2 pb-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span className="flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5 text-amber-500" />系统公告</span>
                {canPost && <button onClick={() => setShowPostForm(!showPostForm)} className="text-[10px] bg-amber-500 hover:bg-amber-600 text-white px-2 py-1 rounded-lg font-semibold flex items-center gap-1 transition-colors"><Plus className="w-3 h-3" />发布</button>}
              </div>

              {showPostForm && (
                <div className="mb-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2">
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="公告标题" className="w-full px-2 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-xs" />
                  <textarea value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="公告内容..." rows={3} className="w-full px-2 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-xs" />
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={newVisibility} onChange={e => setNewVisibility(e.target.value)} className="px-2 py-1 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-slate-900 text-[10px]">
                      <option value="all">全员可见</option>
                      <option value="counselor">仅辅导员</option>
                      <option value="assistant">仅班委</option>
                      <option value="student">仅学生</option>
                    </select>
                    <button onClick={postAnnouncement} className="px-3 py-1 bg-amber-500 text-white rounded-lg text-[10px] font-semibold">确认发布</button>
                    <button onClick={() => setShowPostForm(false)} className="px-2 py-1 bg-slate-200 dark:bg-slate-700 rounded-lg text-[10px]"><X className="w-3 h-3" /></button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {!loaded ? <div className="text-center text-slate-400 py-4">加载中...</div> :
                 announcements.length === 0 ? <div className="text-center text-slate-400 py-4">暂无公告</div> :
                 announcements.map((a: any) => (
                  <div key={a.id} className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between items-start">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{a.title}</div>
                      {(currentUser.role === 'admin' || String(a.sender_id) === String(currentUser.id)) && (
                        <button onClick={() => deleteAnnouncement(a.id)} className="text-[10px] text-rose-500 hover:text-rose-700 shrink-0 ml-2"><X className="w-3 h-3" /></button>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">{a.content}</div>
                    <div className="text-[10px] text-slate-400 mt-1.5 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">{a.sender_name} · {a.sender_role === 'admin' ? '管理员' : a.sender_role === 'counselor' ? '辅导员' : a.sender_role === 'assistant' ? '班委' : '学生'}</span>
                      <span className="shrink-0">{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Account Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setShowThemeMenu(false);
              setShowNotifications(false);
              setShowPostForm(false);
              setShowRoleMenu(!showRoleMenu);
            }}
            className="motion-lift flex max-w-full min-w-0 items-center space-x-1.5 sm:space-x-2 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-blue-600 text-white ring-2 ring-blue-500/30 shrink-0 flex items-center justify-center text-xs font-bold">
              {currentUser.name.slice(0, 1)}
            </div>
            <div className="text-left hidden md:block">
              <div className="text-xs font-bold text-slate-900 dark:text-white leading-tight">
                {currentUser.name}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                {currentUser.studentId}
              </div>
            </div>
            <span className={`flex max-w-[6.5rem] items-center space-x-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold sm:max-w-none ${activeBadge.bg}`}>
              <RoleIcon className="w-3 h-3 mr-0.5 inline shrink-0" />
              <span className="truncate whitespace-nowrap">{activeBadge.label}</span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 hidden sm:block" />
          </button>

          {showRoleMenu && (
            <div className="fixed right-3 top-16 mt-2 w-[calc(100vw-1.5rem)] max-w-xs rounded-lg border border-slate-200 bg-white p-3 shadow-2xl z-50 dark:border-slate-800 dark:bg-slate-900 sm:absolute sm:right-0 sm:top-auto sm:w-60">
              <div className="pb-2 border-b border-slate-100 dark:border-slate-800 mb-2">
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  {currentUser.name}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {currentUser.college}
                </div>
                <div className="text-[10px] text-blue-600 dark:text-blue-400 font-mono mt-0.5">
                  {currentUser.title || currentUser.studentId}
                </div>
              </div>

              <div className="space-y-1">
                {canChangePasswordWithEmail && (
                  <button
                    onClick={() => {
                      setShowRoleMenu(false);
                      setPasswordEmail(currentUser.email || '');
                      setPasswordCode('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setPasswordMessage('');
                    setPasswordCodeCooldown(0);
                    setShowPasswordModal(true);
                    }}
                    className="w-full flex items-center justify-center space-x-1.5 py-2 px-3 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors font-semibold"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>邮箱验证修改密码</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowRoleMenu(false);
                    onLogout();
                  }}
                  className="w-full flex items-center justify-center space-x-1.5 py-2 px-3 rounded-lg text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 transition-colors font-semibold"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>退出系统 / 安全注销</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">邮箱验证修改密码</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">账号：{currentUser.username}</p>
              </div>
              <button
                onClick={() => setShowPasswordModal(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">绑定邮箱</label>
                <input
                  type="email"
                  value={passwordEmail}
                  onChange={e => setPasswordEmail(e.target.value)}
                  placeholder="请输入注册时绑定的邮箱"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">验证码</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={passwordCode}
                    onChange={e => setPasswordCode(e.target.value)}
                    placeholder="6 位验证码"
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <button
                    onClick={sendPasswordCode}
                    disabled={isSendingPasswordCode || passwordCodeCooldown > 0}
                    className="shrink-0 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-blue-700"
                  >
                    {isSendingPasswordCode ? '发送中' : passwordCodeCooldown > 0 ? `${passwordCodeCooldown}s` : '发送验证码'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">新密码</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="至少 6 位"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">确认新密码</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="再次输入"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              {passwordMessage && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {passwordMessage}
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                <button
                  onClick={() => setShowPasswordModal(false)}
                  className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  取消
                </button>
                <button
                  onClick={submitPasswordChange}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
                >
                  确认修改
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
