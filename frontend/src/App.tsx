import React, { useEffect, useMemo, useState } from 'react';
import { AcademicYearConfig, ProofMaterial, RuleCategoryConfig, StudentRecord, StudentScoreSummary, TeacherRecord, User } from './types';
import { apiService, setUnauthorizedHandler } from './services/api';
import { HeaderBar } from './components/HeaderBar';
import { Sidebar, NavItemKey } from './components/Sidebar';
import { LoginModal } from './components/LoginModal';
import { OverviewDashboard } from './components/views/OverviewDashboard';
import { UserManagement } from './components/views/UserManagement';
import { RuleManagement } from './components/views/RuleManagement';
import { AcademicYearArchiving } from './components/views/AcademicYearArchiving';
import { ExcelImportModal } from './components/views/ExcelImportModal';
import { AuditCenter } from './components/views/AuditCenter';
import { StudentDashboard } from './components/views/StudentDashboard';
import { MaterialUploadModal } from './components/views/MaterialUploadModal';
import { PersonalReportPDF } from './components/views/PersonalReportPDF';
import { ExportCenter } from './components/views/ExportCenter';
import { isThemeAccent, THEME_ACCENTS, ThemeAccent, ThemeMode } from './theme';
import { AppAtmosphere } from './components/visual/AppAtmosphere';

export type { ThemeAccent, ThemeMode } from './theme';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(true);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [teachers, setTeachers] = useState<TeacherRecord[]>([]);
  const [ruleConfigs, setRuleConfigs] = useState<RuleCategoryConfig[]>([]);
  const [materials, setMaterials] = useState<ProofMaterial[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearConfig[]>([]);
  const [summaries, setSummaries] = useState<StudentScoreSummary[]>([]);
  const [activeAcademicYear, setActiveAcademicYear] = useState('');
  const [rulesLocked, setRulesLocked] = useState(false);
  const [activeTab, setActiveTab] = useState<NavItemKey>('overview');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<ProofMaterial | null>(null);
  const [loadError, setLoadError] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('zongce_theme');
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  });
  const [themeAccent, setThemeAccent] = useState<ThemeAccent>(() => {
    const stored = localStorage.getItem('zongce_accent');
    return isThemeAccent(stored) ? stored : 'emerald';
  });

  const reload = async () => {
    if (!currentUser) return;
    setLoadError('');
    try {
      const [rulesResult, years] = await Promise.all([apiService.fetchRulesState(), apiService.fetchAcademicYears()]);
      setRuleConfigs(rulesResult.rules);
      setRulesLocked(rulesResult.locked);
      setAcademicYears(years);
      const currentYear = years.find(item => item.isCurrent)?.year || '';
      const queryYear = activeAcademicYear || currentYear;
      if (!activeAcademicYear && queryYear) {
        setActiveAcademicYear(queryYear);
        return;
      }

      if (currentUser.role === 'student') {
        const result = await apiService.fetchMyScore(queryYear);
        setSummaries([result.summary]);
        setMaterials(result.materials);
      } else if (currentUser.role === 'counselor') {
        const [scoreResult, reviewMaterials, fetchedStudents, fetchedTeachers] = await Promise.all([
          apiService.fetchAllCounselorScores(queryYear),
          apiService.fetchReview('counselor', queryYear),
          apiService.fetchStudents(),
          apiService.fetchTeachers()
        ]);
        setSummaries(scoreResult.summaries);
        if (!scoreResult.summaries.length && scoreResult.message) setLoadError(scoreResult.message);
        setMaterials(reviewMaterials);
        setStudents(fetchedStudents);
        setTeachers(fetchedTeachers);
      } else if (currentUser.role === 'assistant') {
        const [classResult, mySubs, reviewMaterials] = await Promise.all([
          apiService.fetchAssistantClassScores(queryYear),
          apiService.fetchMySubmissions().catch(() => []),
          apiService.fetchReview('assistant', queryYear)
        ]);
        // 班级综测数据监察需要全班成绩，而不仅是当前班委自己 1 条
        setSummaries(classResult.summaries.length ? classResult.summaries : []);
        // 合并自己的材料 + 审核列表，自己的材料不会被覆盖
        const myMapped = mySubs.filter((item: any) => item.academicYear === queryYear);
        setMaterials([...myMapped, ...reviewMaterials]);
      } else {
        const [fetchedStudents, fetchedTeachers, allScores, reviewMaterials] = await Promise.all([
          apiService.fetchStudents(),
          apiService.fetchTeachers(),
          apiService.fetchAllScores(queryYear),
          apiService.fetchReview(currentUser.role, queryYear)
        ]);
        setStudents(fetchedStudents);
        setTeachers(fetchedTeachers);
        setSummaries(allScores);
        setMaterials(reviewMaterials);
      }
    } catch (error: any) {
      setLoadError(error?.message || '无法从服务器加载数据');
    }
  };

  useEffect(() => {
    if (apiService.hasSession()) {
      apiService.me().then(user => {
        setCurrentUser(user);
        setShowLoginModal(false);
      }).catch(() => apiService.clearSession());
    }
  }, []);

  useEffect(() => {
    // token 失效（被其它设备登录挤下线/会话过期）时立即回到登录页
    setUnauthorizedHandler(() => {
      setCurrentUser(null);
      setShowLoginModal(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => { reload(); }, [currentUser, activeAcademicYear]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const shouldUseDark = themeMode === 'dark' || (themeMode === 'system' && media.matches);
      document.documentElement.classList.toggle('dark', shouldUseDark);
      document.documentElement.dataset.theme = themeMode;
      localStorage.setItem('zongce_theme', themeMode);
    };

    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [themeMode]);

  useEffect(() => {
    const preset = THEME_ACCENTS[themeAccent];
    const root = document.documentElement;
    root.dataset.accent = themeAccent;
    root.style.setProperty('--zc-accent', preset.accent);
    root.style.setProperty('--zc-accent-hover', preset.accentHover);
    root.style.setProperty('--zc-accent-soft', preset.accentSoft);
    root.style.setProperty('--zc-accent-tint', preset.accentTint);
    root.style.setProperty('--zc-accent-text', preset.accentText);
    root.style.setProperty('--zc-accent-line', preset.accentLine);
    root.style.setProperty('--zc-accent-glow', preset.accentGlow);
    root.style.setProperty('--zc-accent-glow-strong', preset.accentGlowStrong);
    localStorage.setItem('zongce_accent', themeAccent);
  }, [themeAccent]);

  const currentStudentSummary = useMemo(
    () => currentUser ? summaries.find(item => item.studentId === currentUser.studentId) || null : null,
    [currentUser, summaries]
  );
  const pendingMaterialsCount = materials.filter(item => item.status === 'pending' || item.status === 'assistant_approved').length;

  const openUploadModal = () => {
    setEditingMaterial(null);
    setIsMobileMenuOpen(false);
    setShowUploadModal(true);
  };

  const handleTabChange = (tab: NavItemKey) => {
    setShowUploadModal(false);
    setEditingMaterial(null);
    setIsMobileMenuOpen(false);
    setActiveTab(tab);
  };

  const handleReview = async (id: string, status: 'approved' | 'rejected', score?: number, reason?: string) => {
    if (!currentUser) return;
    try {
      await apiService.reviewMaterial(currentUser.role, id, status === 'approved' ? 'approve' : 'reject', reason, score);
      // 立即更新本地 state — 审核通过立刻归类到正确状态
      const newStatus = status === 'approved'
        ? (currentUser.role === 'assistant' ? 'assistant_approved' : 'approved')
        : 'rejected';
      setMaterials(prev => prev.map(m =>
        m.id === id ? { ...m, status: newStatus, requestedScore: status === 'approved' && score !== undefined ? score : m.requestedScore, approvedScore: status === 'approved' ? (score ?? m.requestedScore) : undefined, rejectReason: status === 'rejected' ? (reason || '') : undefined } : m
      ));
      // 服务端写入完成后再整量刷新，保持状态一致
      await reload();
    } catch (error: any) {
      alert(error?.message || '审核提交失败');
    }
  };

  const handleSubmitMaterial = async (data: { moduleId: string; itemId: string; year: string; description: string; awardMonth?: string; proofs?: File[]; count?: number; proofName?: string; onProgress?: (pct: number) => void }) => {
    try {
      const result: any = await apiService.submitMaterial(data);
      setShowUploadModal(false);
      // 立刻把新提交的材料显示在列表中
      if (result) {
        setMaterials(prev => [{ ...result, status: result.status || 'pending', academicYear: data.year }, ...prev]);
      }
      // 服务端写入完成后再整量刷新，保证与数据库一致
      await reload();
    } catch (error: any) {
      alert(error?.message || '材料提交失败');
    }
  };

  const handleEditMaterial = async (data: { moduleId?: string; itemId?: string; description: string; awardMonth?: string; proofs?: File[]; count?: number; proofName?: string; onProgress?: (pct: number) => void }) => {
    if (!editingMaterial) return;
    try {
      await apiService.updateMaterial(editingMaterial.id, data);
      setShowUploadModal(false);
      setEditingMaterial(null);
      await reload();
    } catch (error: any) {
      alert(error?.message || '材料修改失败');
    }
  };

  const handleDeleteMaterial = async (id: string) => {
    try {
      await apiService.deleteMaterial(id);
      await reload();
    } catch (error: any) {
      alert(error?.message || '删除失败');
    }
  };

  if (!currentUser || showLoginModal) {
    return <LoginModal onLoginSuccess={user => { setCurrentUser(user); setShowLoginModal(false); }} />;
  }

  return (
    <div className="app-shell min-h-[100dvh] text-slate-900 dark:text-slate-100 flex flex-col font-sans antialiased overflow-x-hidden">
      <AppAtmosphere accent={themeAccent} />
      <HeaderBar
        currentUser={currentUser}
        onLogout={() => {
          void apiService.logout().finally(() => {
            setCurrentUser(null);
            setShowLoginModal(true);
          });
        }}
        activeAcademicYear={activeAcademicYear}
        onAcademicYearChange={setActiveAcademicYear}
        academicYears={academicYears}
        rulesLocked={rulesLocked}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
        themeAccent={themeAccent}
        onThemeAccentChange={setThemeAccent}
        onToggleMobileMenu={() => {
          setShowUploadModal(false);
          setIsMobileMenuOpen(!isMobileMenuOpen);
        }}
      />
      <div className="flex-1 flex overflow-hidden min-h-0">
        <Sidebar role={currentUser.role} activeTab={activeTab} onTabChange={handleTabChange} pendingCount={pendingMaterialsCount} isMobileOpen={isMobileMenuOpen} onMobileClose={() => setIsMobileMenuOpen(false)} />
        <main className="app-content relative z-10 flex-1 overflow-y-auto p-3 sm:p-5 md:p-7 lg:p-8 max-w-[1440px] mx-auto w-full space-y-6">
          {loadError && <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700">{loadError}</div>}
          {activeTab === 'overview' && (currentUser.role === 'student' || currentUser.role === 'assistant') ? (
            <StudentDashboard currentUser={currentUser} summary={currentStudentSummary} materials={materials} ruleConfigs={ruleConfigs} activeAcademicYear={activeAcademicYear} academicYears={academicYears} onOpenUploadModal={openUploadModal} onEditMaterial={(material) => { setEditingMaterial(material); setShowUploadModal(true); }} onDeleteMaterial={handleDeleteMaterial} onNavigateToPDF={() => handleTabChange('pdf-export')} focusView="overview" />
          ) : activeTab === 'overview' || activeTab === 'class-overview' ? (
            <OverviewDashboard currentUser={currentUser} summaries={summaries} materials={materials} activeAcademicYear={activeAcademicYear} rulesLocked={rulesLocked} onNavigateTab={handleTabChange} />
          ) : null}
          {activeTab === 'my-materials' && <StudentDashboard currentUser={currentUser} summary={currentStudentSummary} materials={materials} ruleConfigs={ruleConfigs} activeAcademicYear={activeAcademicYear} academicYears={academicYears} onOpenUploadModal={openUploadModal} onEditMaterial={(material) => { setEditingMaterial(material); setShowUploadModal(true); }} onDeleteMaterial={handleDeleteMaterial} onNavigateToPDF={() => handleTabChange('pdf-export')} focusView="materials" />}
          {activeTab === 'audit-center' && (
            <AuditCenter
              materials={materials}
              currentUser={currentUser}
              onUpdateMaterialStatus={handleReview}
              onForceDeleteMaterial={() => setTimeout(() => reload(), 300)}
            />
          )}
          {(activeTab === 'rules-config' || activeTab === 'rules-view') && currentUser.role !== 'college_admin' && <RuleManagement ruleConfigs={ruleConfigs} rulesLocked={rulesLocked} onUpdateRuleConfigs={() => reload()} onToggleLockRules={async () => { try { await apiService.toggleRules(currentUser.role); await reload(); } catch (e: any) { alert(e.message); } }} isAdmin={currentUser.role === 'admin'} currentUser={currentUser} />}
          {activeTab === 'user-import' && <UserManagement teachers={teachers} students={students} onUpdateTeachers={setTeachers} onUpdateStudents={setStudents} currentUser={currentUser} />}
          {activeTab === 'archiving' && (currentUser.role === 'admin' || currentUser.role === 'counselor') && <AcademicYearArchiving academicYears={academicYears} activeAcademicYear={activeAcademicYear} onSelectActiveYear={setActiveAcademicYear} onUpdateAcademicYears={setAcademicYears} isAdmin={currentUser.role === 'admin'} currentUser={currentUser} />}
          {activeTab === 'excel-import' && (currentUser.role === 'admin' || currentUser.role === 'college_admin' || currentUser.role === 'counselor') && <ExcelImportModal students={students} ruleConfigs={ruleConfigs} activeAcademicYear={activeAcademicYear} currentUser={currentUser} onImported={reload} />}
          {activeTab === 'score-export' && <ExportCenter summaries={summaries} activeAcademicYear={activeAcademicYear} currentUser={currentUser} />}
          {activeTab === 'pdf-export' && <PersonalReportPDF currentUser={currentUser} summary={currentStudentSummary} materials={materials} activeAcademicYear={activeAcademicYear} onBack={() => setActiveTab('overview')} />}
        </main>
      </div>
      {showUploadModal && <MaterialUploadModal currentUser={currentUser} ruleConfigs={ruleConfigs} activeAcademicYear={activeAcademicYear} editingMaterial={editingMaterial} onClose={() => { setShowUploadModal(false); setEditingMaterial(null); }} onSubmitMaterial={editingMaterial ? handleEditMaterial : handleSubmitMaterial} />}
    </div>
  );
}
