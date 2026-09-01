import { AcademicYearConfig, ProofMaterial, RuleCategoryConfig, StudentRecord, StudentScoreSummary, TeacherRecord, User } from '../types.js';
import { classScopeKey } from '../utils/className.js';

// The deployed Express API is the single source of truth for this frontend.
const BASE_URL = (import.meta as any).env?.VITE_BACKEND_API_URL || '';
const TOKEN_KEY = 'zongce_token';

const CATEGORY_BY_NAME: Record<string, RuleCategoryConfig['category']> = {
  '德育': 'moral', '智育': 'intellectual', '体育': 'physical',
  '能力': 'ability', '美育': 'aesthetics', '劳动': 'labor', '劳育': 'labor'
};

// 全局 401 回调：token 失效（被其它设备登录挤下线/过期）时通知 UI 回到登录页
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function handleUnauthorized() {
  localStorage.removeItem(TOKEN_KEY);
  unauthorizedHandler?.();
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function toQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const encoded = search.toString();
  return encoded ? '?' + encoded : '';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', 'Bearer ' + token);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(BASE_URL + '/api' + path, { cache: 'no-store', ...options, headers });
  if (response.status === 401) handleUnauthorized();
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || body.message || '请求失败');
  }
  return response.json() as Promise<T>;
}

function mapUser(user: any): User {
  const detail = user.studentInfo || user.teacherInfo || {};
  return {
    id: String(user.id),
    username: user.account,
    name: user.name,
    role: user.isAssistant ? 'assistant' : user.role,
    email: user.email || detail.email || '',
    college: detail.college_name || detail.college || '',
    grade: detail.grade || '',
    majorClass: detail.class_name || '',
    studentId: detail.student_id || detail.employee_id || user.account,
    studentDbId: detail.student_id ? String(detail.id) : undefined,
    title: user.role === 'counselor' ? '辅导员' : undefined
  };
}

export function mapRules(data: any): RuleCategoryConfig[] {
  return (data.modules || []).map((module: any) => ({
    moduleId: Number(module.id),
    category: CATEGORY_BY_NAME[module.name] || 'extra',
    categoryName: module.name,
    baseWeight: Number(module.weight) / 100,
    maxBonusCap: 0,
    items: (module.items || []).map((item: any) => ({
      id: String(item.id),
      category: CATEGORY_BY_NAME[module.name] || 'extra',
      categoryName: module.name,
      name: item.name,
      description: item.description || '',
      evidence: item.evidence || '',
      maxScore: Number(item.max_score),
      unitScore: Number(item.max_score),
      requiresProof: Boolean(item.requires_proof),
      scoreType: 'fixed' as const
    }))
  }));
}

export function mapSubmission(submission: any): ProofMaterial {
  // 保留数据库原始状态，各端按需解读
  const status = submission.status;
  return {
    id: String(submission.id),
    studentId: submission.student_code || String(submission.student_id),
    studentName: submission.student_name || '',
    majorClass: submission.class_name || '',
    academicYear: submission.year_name || String(submission.academic_year_id || ''),
    categoryId: CATEGORY_BY_NAME[submission.module_name] || 'extra',
    categoryName: submission.module_name || '未分类',
    ruleItemId: String(submission.item_id),
    ruleItemName: submission.item_name || '',
    title: submission.item_name || '综测材料',
    description: submission.description || '',
    awardMonth: submission.award_month || undefined,
    proofUrl: submission.proof_path
      ? BASE_URL + '/api/files/proof/' + submission.id + '?token=' + encodeURIComponent(getToken())
      : undefined,
    requestedScore: Number(submission.score) || 0,
    approvedScore: status === 'approved' ? Number(submission.score) : undefined,
    status,
    submittedAt: submission.submit_at || '',
    reviewedAt: submission.counselor_review_at || submission.assistant_review_at,
    reviewerRole: submission.assistant_reviewer_id ? 'assistant' : submission.counselor_reviewer_id ? 'counselor' : undefined,
    rejectReason: submission.rejection_reason || undefined
  };
}

function moduleScore(ranking: any, moduleName: string) {
  const module = (ranking.modules || []).find((item: any) => item.moduleName === moduleName);
  if (!module) return null;
  const approved = Number(module.approvedScore || 0);
  const imported = Number(module.importedScore || 0);
  const hasBreakdown = module.approvedScore !== undefined || module.importedScore !== undefined;
  return {
    score: Number(module.score || 0),
    approved,
    imported,
    hasBreakdown,
    base: Number(module.baseScore || 0),
    // 服务端已含基础分时用 finalScore，兼容未升级前的旧响应
    final: Number(module.finalScore ?? module.score ?? 0),
  };
}

export function mapRanking(ranking: any, year: string, college = ''): StudentScoreSummary {
  // 分数一律来自服务端:score=模块原始加分, finalScore=已含基础分的最终分
  const ZERO = { score: 0, approved: 0, imported: 0, hasBreakdown: true, base: 0, final: 0 };
  const moral = moduleScore(ranking, '德育') || ZERO;
  const ability = moduleScore(ranking, '能力') || ZERO;
  const aesthetic = moduleScore(ranking, '美育') || ZERO;
  const labor = moduleScore(ranking, '劳动') || moduleScore(ranking, '劳育') || ZERO;
  const intellectual = moduleScore(ranking, '智育') || ZERO;
  const physical = moduleScore(ranking, '体育') || ZERO;
  const totalScore = Number(ranking.totalScore || 0);

  const moralDelta = moral.score;
  const abilityDelta = ability.score;
  const aestheticDelta = aesthetic.score;
  const laborDelta = labor.score;
  const physicalImported = physical.hasBreakdown ? physical.imported : physical.score;
  const physicalApproved = physical.hasBreakdown ? physical.approved : 0;

  return {
    studentId: ranking.studentCode, studentName: ranking.studentName, grade: ranking.grade || '',
    majorClass: ranking.className || '', college, academicYear: year,
    moralBase: moral.base, moralDeduction: Math.max(0, -(moral.hasBreakdown ? moral.imported : Math.min(moralDelta, 0))), intellectualBase: intellectual.final,
    physicalBase: physicalImported, abilityBase: ability.base, aestheticsBase: aesthetic.base, laborBase: labor.base,
    moralBonus: Math.max(0, moral.hasBreakdown ? moral.approved : moralDelta), intellectualBonus: 0, physicalBonus: Math.max(0, physicalApproved),
    abilityBonus: Math.max(0, abilityDelta), aestheticsBonus: Math.max(0, aestheticDelta),
    laborBonus: Math.max(0, laborDelta), extraBonus: 0,
    moralFinal: moral.final, intellectualFinal: intellectual.final, physicalFinal: physical.final, abilityFinal: ability.final, aestheticsFinal: aesthetic.final, laborFinal: labor.final,
    evaluationGrade: totalScore >= 90 ? '优秀' : totalScore >= 80 ? '良好' : totalScore >= 70 ? '中等' : totalScore >= 60 ? '合格' : '不合格',
    isDisqualified: moral.final < 60 || intellectual.final < 60,
    totalScore, classRank: Number(ranking.rank || 0), classTotal: 0, gradeRank: 0, gradeTotal: 0
  };
}

export const apiService = {
  clearSession() { localStorage.removeItem(TOKEN_KEY); },
  hasSession() { return Boolean(getToken()); },
  async logout() {
    try {
      if (getToken()) await request('/auth/logout', { method: 'POST' });
    } catch (_error) {
      // Local cleanup must still happen if the server session is already expired.
    } finally {
      localStorage.removeItem(TOKEN_KEY);
    }
  },
  async fetchRegisterOptions() {
    return request<{
      colleges: Array<{ id: number; name: string; code: string }>;
      majors: string[];
      classes: Array<{ className: string; major: string; grade: string; collegeId: number | null; counselors: Array<{ id: number; name: string; grade: string }> }>;
      counselors: Array<{ id: number; name: string; grade: string }>;
    }>('/auth/register-options');
  },
  sendEmailCode(data: { email: string; purpose: 'register' | 'reset_password'; account?: string }) {
    return request('/auth/send-code', { method: 'POST', body: JSON.stringify(data) });
  },
  resetPassword(data: { account: string; email: string; code: string; newPassword: string }) {
    return request('/auth/reset-password', { method: 'POST', body: JSON.stringify(data) });
  },
  async login(account: string, password: string) {
    const result = await request<{ token: string; user: any }>('/auth/login', {
      method: 'POST', body: JSON.stringify({ account, password })
    });
    localStorage.setItem(TOKEN_KEY, result.token);
    return mapUser(result.user);
  },
  async registerStudent(data: { account: string; name: string; password: string; email: string; emailCode: string; major: string; className: string; counselorName: string; grade: string; gender?: string; collegeId?: number | null }) {
    const result = await request<{ token: string; user: any }>('/auth/register', {
      method: 'POST', body: JSON.stringify(data)
    });
    localStorage.setItem(TOKEN_KEY, result.token);
    return mapUser(result.user);
  },
  async registerCounselor(data: { account: string; name: string; password: string; email: string; emailCode: string; major: string; className: string; grade: string; collegeId?: number | null; classes?: Array<{ grade: string; major: string; className: string; collegeId?: number | null }> }) {
    const result = await request<{ token: string; user: any }>('/auth/register', {
      method: 'POST', body: JSON.stringify({ ...data, role: 'counselor' })
    });
    localStorage.setItem(TOKEN_KEY, result.token);
    return mapUser(result.user);
  },
  async me() {
    const result = await request<{ user: any }>('/auth/me');
    return mapUser(result.user);
  },
  health() { return request<{ ok: boolean; service: string }>('/health'); },
  async fetchRules() { return mapRules(await request<any>('/rules')); },
  async fetchRulesState() {
    const result = await request<any>('/rules');
    return { rules: mapRules(result), locked: Boolean(result.locked) };
  },
  async fetchAcademicYears(): Promise<AcademicYearConfig[]> {
    const result = await request<{ years: any[] }>('/years');
    return result.years.map(item => ({
      id: Number(item.id),
      year: item.name,
      isCurrent: Boolean(item.is_current),
      isLocked: Boolean(item.is_locked),
      deadline: item.deadline || undefined
    }));
  },
  async fetchStudents(): Promise<StudentRecord[]> {
    const result = await request<{ students: any[] }>('/admin/students');
    return result.students.map(item => ({
      id: String(item.id), studentId: item.student_id, name: item.name, grade: item.grade || '',
      majorClass: item.class_name || '', college: item.college_name || '', gender: item.gender
    }));
  },
  async fetchTeachers(): Promise<TeacherRecord[]> {
    const result = await request<{ teachers: any[] }>('/admin/teachers');
    return result.teachers.map(item => ({
      id: String(item.id), teacherId: item.employee_id, name: item.name, college: item.college_name || '',
      email: item.email || '', grade: item.grade || '', title: '辅导员',
      classes: Array.isArray(item.classes)
        ? item.classes
        : String(item.classes || '').split(',').map((cls: string) => cls.trim()).filter(Boolean)
    }));
  },
  async fetchMySubmissions() {
    const result = await request<{ submissions: any[] }>('/student/submissions');
    return result.submissions.map(mapSubmission);
  },
  async fetchReview(role: User['role'], year: string) {
    const root = role === 'assistant' ? '/assistant' : role === 'admin' ? '/admin' : '/counselor';
    const result = await request<{ submissions: any[] }>(root + '/review' + toQuery({ yearId: year }));
    return result.submissions.map(mapSubmission);
  },
  async submitMaterial(data: { moduleId: string; itemId: string; year: string; description: string; awardMonth?: string; proof?: File; count?: number; proofName?: string; onProgress?: (pct: number) => void }) {
    const form = new FormData();
    form.set('moduleId', data.moduleId);
    form.set('itemId', data.itemId);
    form.set('academicYearId', data.year);
    form.set('description', data.description);
    if (data.awardMonth) form.set('award_month', data.awardMonth);
    if (data.count && data.count > 1) form.set('count', String(data.count));
    if (data.proofName) form.set('proof_name', data.proofName);
    if (data.proof) form.set('proof', data.proof);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', BASE_URL + '/api/student/submissions');
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);

      if (data.onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) data.onProgress!(Math.round((e.loaded / e.total) * 100));
        };
      }

      xhr.onload = () => {
        try {
          if (xhr.status === 401) handleUnauthorized();
          const result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(mapSubmission(result.submission));
          } else {
            reject(new Error(result.error || '提交失败 (' + xhr.status + ')'));
          }
        } catch (e) { reject(new Error('提交失败 (' + xhr.status + ')')); }
      };
      xhr.onerror = () => reject(new Error('网络错误，上传失败'));
      xhr.send(form);
    });
  },
  deleteMaterial(id: string) { return request('/student/submissions/' + id, { method: 'DELETE' }); },
  adminDeleteMaterial(id: string) { return request('/admin/submissions/' + id, { method: 'DELETE' }); },
  counselorDeleteMaterial(id: string) { return request('/counselor/submissions/' + id, { method: 'DELETE' }); },
  batchDeleteMaterials(role: 'admin' | 'counselor', ids: string[]) {
    return request((role === 'admin' ? '/admin' : '/counselor') + '/submissions/batch-delete', {
      method: 'POST', body: JSON.stringify({ ids })
    });
  },
  cleanupProofOrphans(files: string[]) { return request<{ deletedCount: number; failedCount: number }>('/admin/proofs/cleanup', { method: 'POST', body: JSON.stringify({ files }) }); },
  reviewMaterial(role: User['role'], id: string, action: 'approve' | 'reject', reason?: string) {
    const root = role === 'assistant' ? '/assistant' : role === 'admin' ? '/admin' : '/counselor';
    return request(root + '/review/' + id, { method: 'PUT', body: JSON.stringify({ action, reason: reason || '' }) });
  },
  async fetchMyScore(year: string) {
    const result = await request<any>('/student/scores' + toQuery({ yearId: year }));
    const ranking = {
      studentCode: result.student.student_id, studentName: result.student.name, className: result.student.class_name,
      grade: result.student.grade, totalScore: result.totalScore, rank: result.rank,
      modules: result.moduleScores.map((item: any) => ({ moduleName: item.name, score: item.score, baseScore: item.baseScore, finalScore: item.finalScore }))
    };
    const summary = mapRanking(ranking, year, result.student.college_name || '');
    summary.classTotal = Number(result.totalInClass || 0);
    return { summary, materials: (await apiService.fetchMySubmissions()).filter(item => item.academicYear === year) };
  },
  async fetchClassScores(year: string, className?: string) {
    const result = await request<{ rankings: any[]; className: string; classNames: string[] }>(
      '/counselor/scores' + toQuery({ yearId: year, className })
    );
    const summaries = result.rankings.map(item => mapRanking(item, year));
    summaries.forEach(item => { item.classTotal = summaries.length; });
    return { summaries, className: result.className, classNames: result.classNames };
  },

  // 班委获取本班/本年级全量成绩（用于班级综测数据监察补全）
  async fetchAssistantClassScores(year: string) {
    const result = await request<{ rankings: any[]; className: string; grade: string }>(
      '/assistant/scores' + toQuery({ yearId: year })
    );
    const summaries = result.rankings.map(item => mapRanking(item, year));
    summaries.forEach(item => { item.classTotal = summaries.length; });
    return { summaries, className: result.className, grade: result.grade };
  },

  // 辅导员获取所有负责班级的成绩
  async fetchAllCounselorScores(year: string) {
    const result = await apiService.fetchClassScores(year);
    const allSummaries = result.summaries;
    const allClasses = result.classNames || [];
    // 按班级分组重新计算排名
    const byClass = new Map<string, StudentScoreSummary[]>();
    allSummaries.forEach(s => {
      const key = classScopeKey(s.majorClass, s.grade, s.studentId);
      const list = byClass.get(key) || [];
      list.push(s);
      byClass.set(key, list);
    });
    byClass.forEach(list => {
      list.sort((a, b) => b.totalScore - a.totalScore);
      list.forEach((s, i) => {
        s.classRank = i + 1;
        s.classTotal = list.length;
      });
    });
    return { summaries: allSummaries, classNames: allClasses };
  },
  async fetchAllScores(year: string) {
    const result = await request<{ rankings: any[] }>('/admin/scores' + toQuery({ yearId: year }));
    const summaries = result.rankings.map(item => mapRanking(item, year));
    const byClass = new Map<string, StudentScoreSummary[]>();
    summaries.forEach(item => {
      const key = classScopeKey(item.majorClass, item.grade, item.studentId);
      const group = byClass.get(key) || [];
      group.push(item);
      byClass.set(key, group);
    });
    byClass.forEach(group => group.forEach(item => { item.classTotal = group.length; }));
    return summaries;
  },
  importScores(role: 'admin' | 'counselor', scores: Array<{ studentId: string; score: number }>, moduleId: string, itemId: string, year: string) {
    return request((role === 'admin' ? '/admin' : '/counselor') + '/scores/import', {
      method: 'POST', body: JSON.stringify({ scores, moduleId: Number(moduleId), itemId: Number(itemId), yearId: year })
    });
  },
  importMoralDeductions(role: 'admin' | 'counselor', deductions: Array<{ studentId: string; itemId: string | number; count?: number; score?: number }>, year: string) {
    return request((role === 'admin' ? '/admin' : '/counselor') + '/scores/moral-deductions/import', {
      method: 'POST', body: JSON.stringify({ deductions, yearId: year })
    });
  },
  toggleRules(role: User['role']) {
    // 规则锁定仅对管理员开放；辅导员/班委端不提供锁定接口
    return request('/admin/rules/lock', { method: 'PUT' });
  },
  // 管理员规则 CRUD
  createScoringModule(name: string, weight: number) { return request('/admin/rules/modules', { method: 'POST', body: JSON.stringify({ name, weight }) }); },
  updateScoringModule(id: number, weight: number) { return request('/admin/rules/modules/' + id, { method: 'PUT', body: JSON.stringify({ weight }) }); },
  deleteScoringModule(id: number) { return request('/admin/rules/modules/' + id, { method: 'DELETE' }); },
  createScoringItem(data: { moduleId: number; name: string; maxScore: number; description: string; requiresProof: boolean; evidence: string }, role: User['role'] = 'admin') {
    return request((role === 'counselor' ? '/counselor' : '/admin') + '/rules/items', { method: 'POST', body: JSON.stringify(data) });
  },
  updateScoringItem(id: number, data: { moduleId?: number; name?: string; maxScore?: number; description?: string; requiresProof?: boolean; evidence?: string }, role: User['role'] = 'admin') {
    return request((role === 'counselor' ? '/counselor' : '/admin') + '/rules/items/' + id, { method: 'PUT', body: JSON.stringify(data) });
  },
  deleteScoringItem(id: number, role: User['role'] = 'admin') {
    return request((role === 'counselor' ? '/counselor' : '/admin') + '/rules/items/' + id, { method: 'DELETE' });
  },
  // 用户管理
  createYear(name: string, deadline?: string) {
    return request<{ year: any }>('/admin/years', { method: 'POST', body: JSON.stringify({ name, deadline: deadline || null }) });
  },
  toggleYearLock(id: number, locked: boolean) {
    return request('/admin/years/' + id + '/lock', { method: 'PUT', body: JSON.stringify({ locked }) });
  },
  updateYearDeadline(role: 'admin' | 'counselor', id: number, deadline?: string) {
    return request((role === 'counselor' ? '/counselor' : '/admin') + '/years/' + id + '/deadline', {
      method: 'PUT', body: JSON.stringify({ deadline: deadline || null })
    });
  },
  activateYear(id: number) {
    return request('/admin/years/' + id + '/activate', { method: 'PUT' });
  },
  createStudent(data: any) { return request('/admin/students', { method: 'POST', body: JSON.stringify(data) }); },
  createTeacher(data: any) { return request('/admin/teachers', { method: 'POST', body: JSON.stringify(data) }); },
  updateTeacher(id: string, data: any) { return request('/admin/teachers/' + id, { method: 'PUT', body: JSON.stringify(data) }); },
  updateTeacherGrade(id: string, grade: string) { return request('/admin/teachers/' + id + '/grade', { method: 'PUT', body: JSON.stringify({ grade }) }); },
  importStudents(students: any[]) { return request('/admin/students/import', { method: 'POST', body: JSON.stringify({ students }) }); },
  importTeachers(teachers: any[]) { return request('/admin/teachers/import', { method: 'POST', body: JSON.stringify({ teachers }) }); },
  deleteStudent(id: number) { return request('/admin/students/' + id, { method: 'DELETE' }); },
  deleteTeacher(id: number) { return request('/admin/teachers/' + id, { method: 'DELETE' }); },
  batchDeleteStudents(ids: number[]) { return request('/admin/students/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }); },
  batchDeleteTeachers(ids: number[]) { return request('/admin/teachers/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }); },
  promoteAssistant(studentId: string, className?: string) { return request('/admin/assistants/promote', { method: 'POST', body: JSON.stringify({ studentId, className }) }); },
  demoteAssistant(studentId: string) { return request('/admin/assistants/demote', { method: 'POST', body: JSON.stringify({ studentId }) }); },
  getAssistants() { return request('/admin/assistants'); },
  // ============ 公告通知 ============
  fetchAnnouncements() { return request<{ announcements: any[] }>('/announcements'); },
  createAnnouncement(data: { title: string; content: string; visibility?: string; targetUserId?: number }) { return request('/announcements', { method: 'POST', body: JSON.stringify(data) }); },
  deleteAnnouncement(id: number) { return request('/announcements/' + id, { method: 'DELETE' }); },

  // 辅导员工作台概览
  fetchCounselorOverview(year: string) { return request<{ classNames: string[]; totalStudents: number; totalPending: number; grade?: string; configuredGrade?: string; inferredGrade?: string; classOverviews: Array<{ className: string; studentCount: number; pendingCount: number; avg: string; max: string }> }>('/counselor/overview' + toQuery({ yearId: year })); },
  // 辅导员/班委登分表数据
  fetchScoreTable(role: User['role'], year: string, className?: string) {
    const root = role === 'assistant' ? '/assistant' : '/counselor';
    return request<{ rows: any[]; className: string; total: number }>(root + '/scores/table' + toQuery({ yearId: year, className }));
  },
  // 更新教师班级
  updateTeacherClasses(teacherId: string, classes: string[]) { return request('/admin/teachers/' + teacherId + '/classes', { method: 'PUT', body: JSON.stringify({ classes }) }); },
  // 辅导员提交班级变更申请
  submitClassRequest(action: string, className: string, reason: string) { return request('/counselor/class-request', { method: 'POST', body: JSON.stringify({ action, class_name: className, reason }) }); },
  submitGradeRequest(grade: string, reason: string) { return request('/counselor/class-request', { method: 'POST', body: JSON.stringify({ request_type: 'grade', grade, reason }) }); },
  // 管理员查看/审批班级变更
  fetchClassRequests(status?: string) { return request<{ requests: any[] }>('/admin/class-requests' + (status ? '?status=' + status : '')); },
  approveClassRequest(id: number, action: 'approve' | 'reject') { return request('/admin/class-requests/' + id, { method: 'PUT', body: JSON.stringify({ action }) }); },
  checkProofFiles(year: string) { return request<any>('/admin/proofs/check' + toQuery({ yearId: year })); },
  // 获取学院/专业统计
  fetchStudentStats() { return request('/admin/stats'); },
  // 获取学院及班级级联数据
  fetchCollegesClasses() { return request<{ colleges: Array<{ id: number; name: string; code: string; classes: string[] }> }>('/admin/colleges-classes'); },
  fetchClassOptions() { return request<{ options: Array<{ id: number; college_id: number | null; college_name?: string; grade: string; major: string; class_name: string; counselors: Array<{ id: number; name: string; grade: string }> }> }>('/admin/class-options'); },
  createClassOption(data: { collegeId?: number | null; grade: string; major: string; className: string; counselorId?: number | null }) { return request('/admin/class-options', { method: 'POST', body: JSON.stringify(data) }); },
  updateClassOption(id: number, data: { collegeId?: number | null; grade: string; major: string; className: string; counselorId?: number | null }) { return request('/admin/class-options/' + id, { method: 'PUT', body: JSON.stringify(data) }); },
  importClassOptions(options: Array<{ collegeId?: number | null; grade: string; major: string; className: string; counselorEmployeeId?: string; counselorName?: string }>) { return request<{ count: number; counselorBound: number; counselorFailed: number }>('/admin/class-options/import', { method: 'POST', body: JSON.stringify({ options }) }); },
  assignClassOptionCounselor(id: number, counselorId: number) { return request('/admin/class-options/' + id + '/counselor', { method: 'PUT', body: JSON.stringify({ counselorId }) }); },
  deleteClassOption(id: number) { return request('/admin/class-options/' + id, { method: 'DELETE' }); },
  batchDeleteClassOptions(ids: number[]) { return request('/admin/class-options/batch-delete', { method: 'POST', body: JSON.stringify({ ids }) }); },
  exportUrl(path: string) {
    return BASE_URL + '/api' + path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(getToken());
  },
  openAuthorizedPage(path: string) {
    window.open(this.exportUrl(path), '_blank', 'noopener');
  },
  async download(path: string, filename: string) {
    const headers = new Headers();
    if (getToken()) headers.set('Authorization', 'Bearer ' + getToken());
    const response = await fetch(BASE_URL + '/api' + path, { headers });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(body.error || '导出失败');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
};
