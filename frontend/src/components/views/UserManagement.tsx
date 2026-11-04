import React, { useEffect, useState } from 'react';
import { TeacherRecord, StudentRecord, User } from '../../types';
import { downloadClassOptionImportTemplate, downloadTeacherImportTemplate, downloadStudentImportTemplate, parseExcelFile, exportStudentRosterExcel, exportTeacherRosterExcel } from '../../utils/excel';
import { Download, Upload, Plus, Trash2, Search, CheckCircle2, FileSpreadsheet, Lock, ClipboardList, ArrowUp, Pencil, X } from 'lucide-react';
import { apiService } from '../../services/api';
import { inferGradeFromStudentId, normalizeGrade } from '../../utils/className';

interface UserManagementProps {
  teachers: TeacherRecord[];
  students: StudentRecord[];
  onUpdateTeachers: (teachers: TeacherRecord[]) => void;
  onUpdateStudents: (students: StudentRecord[]) => void;
  currentUser?: User;
}

interface ClassChangeRequest {
  id: number;
  teacher_name: string;
  request_type?: 'class' | 'grade';
  action: 'add' | 'remove' | 'change';
  class_name: string;
  grade?: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at?: string;
}

const cnNumberMap: Record<string, string> = { 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9', 十: '10' };

function normalizeSearchText(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function normalizeClassText(value: unknown) {
  let text = normalizeSearchText(value).replace(/^20\d{2}级?/, '').replace(/^\d{2}级?/, '');
  Object.entries(cnNumberMap).forEach(([cn, num]) => {
    text = text.replace(new RegExp(cn + '班', 'g'), num + '班');
  });
  return text;
}

function fieldHit(query: string, fields: Array<unknown>, exact: boolean) {
  const q = normalizeSearchText(query);
  const cq = normalizeClassText(query);
  if (!q) return true;
  return fields.some(field => {
    const text = normalizeSearchText(field);
    const cls = normalizeClassText(field);
    return exact ? text === q || cls === cq : text.includes(q) || cls.includes(cq);
  });
}

function gradeYearInput(value: unknown) {
  return String(value || '').replace(/\D/g, '').slice(0, 4);
}

function isExampleImportRow(values: unknown[]) {
  return values.some(value => /^示例[:：]/.test(String(value || '').trim()));
}

export const UserManagement: React.FC<UserManagementProps> = ({
  teachers,
  students,
  onUpdateTeachers,
  onUpdateStudents,
  currentUser
}) => {
  const isSuperAdmin = currentUser?.role === 'admin' || currentUser?.role === 'college_admin';
  const isCounselorOrAdmin = currentUser?.role === 'admin' || currentUser?.role === 'college_admin' || currentUser?.role === 'counselor';
  const [activeSubTab, setActiveSubTab] = useState<'students' | 'teachers' | 'assistants' | 'classOptions' | 'collegeAdmins'>('students');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState<string>('all');
  const [importStatusMsg, setImportStatusMsg] = useState<string>('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [selectedClassOptionIds, setSelectedClassOptionIds] = useState<number[]>([]);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  // ============ 班委管理 ============
  const [assistantStudentId, setAssistantStudentId] = useState('');
  const [assistantClassName, setAssistantClassName] = useState('');
  const [assistantList, setAssistantList] = useState<Array<{ student_id: string; name: string; class_name: string }>>([]);
  const [showAssistantTab, setShowAssistantTab] = useState(false);
  const [collegeAdmins, setCollegeAdmins] = useState<Array<{ id: number; account: string; name: string; email?: string; college_id: number; college_name?: string }>>([]);
  const [newCollegeAdmin, setNewCollegeAdmin] = useState({ account: '', name: '', email: '', collegeId: '', password: '' });

  const loadAssistants = async () => {
    try {
      const result: any = await apiService.getAssistants();
      setAssistantList(result.assistants || []);
      setShowAssistantTab(true);
    } catch (e) { /* ignore */ }
  };

  const loadCollegeAdmins = async () => {
    if (!isSuperAdmin) return;
    try {
      const result = await apiService.fetchCollegeAdmins();
      setCollegeAdmins(result.admins || []);
    } catch (e) { /* ignore */ }
  };

  const createCollegeAdmin = async () => {
    if (!newCollegeAdmin.account.trim() || !newCollegeAdmin.name.trim() || !newCollegeAdmin.collegeId) return alert('请填写账号、姓名和学院');
    try {
      const result: any = await apiService.createCollegeAdmin({
        account: newCollegeAdmin.account.trim(),
        name: newCollegeAdmin.name.trim(),
        email: newCollegeAdmin.email.trim() || undefined,
        collegeId: Number(newCollegeAdmin.collegeId),
        password: newCollegeAdmin.password.trim() || undefined,
      });
      alert(`二级管理员已创建，初始密码：${result.initialPassword}`);
      setNewCollegeAdmin({ account: '', name: '', email: '', collegeId: newCollegeAdmin.collegeId, password: '' });
      loadCollegeAdmins();
    } catch (e: any) { alert('创建失败: ' + (e.message || '请重试')); }
  };

  const deleteCollegeAdmin = async (id: number) => {
    if (!confirm('确定停用该二级管理员账号？')) return;
    try { await apiService.deleteCollegeAdmin(id); loadCollegeAdmins(); }
    catch (e: any) { alert('停用失败: ' + (e.message || '请重试')); }
  };

  const promoteAssistant = async () => {
    if (!assistantStudentId.trim()) return alert('请输入学号');
    try {
      await apiService.promoteAssistant(assistantStudentId.trim(), assistantClassName.trim() || undefined);
      alert('已提升为班委');
      loadAssistants();
      setAssistantStudentId('');
    } catch (e: any) { alert('操作失败: ' + (e.message || '请重试')); }
  };

  const demoteAssistant = async (studentId: string) => {
    if (!confirm('确定降级该班委？')) return;
    try {
      await apiService.demoteAssistant(studentId);
      alert('已降级');
      loadAssistants();
    } catch (e: any) { alert('操作失败: ' + (e.message || '请重试')); }
  };

  // Manual Add Student State
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({
    studentId: '',
    name: '',
    password: '',
    grade: '',
    majorClass: '',
    classOptionId: '',
    college: '',
    gender: '男',
    counselorName: ''
  });

  // Manual Add Teacher State
  const [showAddTeacher, setShowAddTeacher] = useState(false);
  const [showEditTeacherClasses, setShowEditTeacherClasses] = useState(false);
  const [showEditTeacherGrade, setShowEditTeacherGrade] = useState(false);
  const [editTeacherId, setEditTeacherId] = useState('');
  const [editTeacherName, setEditTeacherName] = useState('');
  const [editTeacherClasses, setEditTeacherClasses] = useState('');
  const [editTeacherOriginalClasses, setEditTeacherOriginalClasses] = useState<string[]>([]);
  const [editTeacherGrade, setEditTeacherGrade] = useState('');
  const [collegesWithClasses, setCollegesWithClasses] = useState<Array<{ id: number; name: string; code: string; classes: string[] }>>([]);
  const [selectedCollegeId, setSelectedCollegeId] = useState<string>('');
  const [classRequests, setClassRequests] = useState<ClassChangeRequest[]>([]);
  const [newTeacher, setNewTeacher] = useState({
    teacherId: '',
    name: '',
    email: '',
    grade: '2025级',
    college: '',
    collegeId: '',
    title: '辅导员',
    classes: '',
    password: ''
  });
  const [classOptions, setClassOptions] = useState<Array<{
    id: number;
    college_id: number | null;
    college_name?: string;
    grade: string;
    major: string;
    class_name: string;
    counselors: Array<{ id: number; name: string; grade: string }>;
  }>>([]);
  const [newClassOption, setNewClassOption] = useState({ collegeId: '', grade: '', major: '', className: '', counselorId: '' });
  const [classCounselorSelections, setClassCounselorSelections] = useState<Record<number, string>>({});
  const [editingClassOptionId, setEditingClassOptionId] = useState<number | null>(null);

  const closeAllDialogs = () => {
    setShowAddStudent(false);
    setShowAddTeacher(false);
    setShowEditTeacherClasses(false);
    setShowEditTeacherGrade(false);
  };

  const openAddStudentDialog = () => {
    closeAllDialogs();
    setShowAddStudent(true);
    if (collegesWithClasses.length === 0) loadCollegesData();
    if (isSuperAdmin && classOptions.length === 0) loadClassOptions();
  };

  const openAddTeacherDialog = () => {
    closeAllDialogs();
    setShowAddTeacher(true);
    if (collegesWithClasses.length === 0) loadCollegesData();
  };

  // Load college-class cascade data
  const loadCollegesData = async () => {
    try {
      const res: any = await apiService.fetchCollegesClasses();
      if (res.colleges) {
        setCollegesWithClasses(res.colleges);
        if (!selectedCollegeId && res.colleges.length > 0) setSelectedCollegeId(String(res.colleges[0].id));
      }
    } catch (e) { /* ignore */ }
  };

  const loadClassOptions = async () => {
    if (!isSuperAdmin) return;
    try {
      const res = await apiService.fetchClassOptions();
      setClassOptions(res.options || []);
    } catch (e) { /* ignore */ }
  };

  const saveClassOption = async () => {
    if (!isSuperAdmin) return alert('仅管理员可维护专业班级');
    if (!newClassOption.grade.trim() || !newClassOption.major.trim() || !newClassOption.className.trim()) return alert('请填写年级、专业和班级');
    try {
      const className = newClassOption.className.trim();
      await apiService.createClassOption({
        collegeId: newClassOption.collegeId ? Number(newClassOption.collegeId) : null,
        grade: newClassOption.grade.trim(),
        major: newClassOption.major.trim(),
        className,
        counselorId: newClassOption.counselorId ? Number(newClassOption.counselorId) : null
      });
      setNewClassOption({ collegeId: newClassOption.collegeId, grade: '', major: '', className: '', counselorId: '' });
      await loadClassOptions();
      await loadCollegesData();
      const result = await apiService.fetchTeachers();
      onUpdateTeachers(result as any);
      setImportStatusMsg(newClassOption.counselorId ? '专业班级及对应辅导员已保存。' : '专业班级已保存，后续可再绑定辅导员。');
    } catch (e: any) { alert('保存失败: ' + (e.message || '请重试')); }
  };

  const beginEditClassOption = (option: typeof classOptions[number]) => {
    setEditingClassOptionId(option.id);
    setNewClassOption({
      collegeId: option.college_id ? String(option.college_id) : '',
      grade: gradeYearInput(option.grade),
      major: option.major,
      className: option.class_name,
      counselorId: option.counselors?.[0]?.id ? String(option.counselors[0].id) : ''
    });
    setActiveSubTab('classOptions');
  };

  const cancelEditClassOption = () => {
    setEditingClassOptionId(null);
    setNewClassOption({ collegeId: '', grade: '', major: '', className: '', counselorId: '' });
  };

  const updateClassOption = async () => {
    if (!isSuperAdmin || !editingClassOptionId) return;
    if (!newClassOption.grade.trim() || !newClassOption.major.trim() || !newClassOption.className.trim()) return alert('请填写年级、专业和班级');
    try {
      await apiService.updateClassOption(editingClassOptionId, {
        collegeId: newClassOption.collegeId ? Number(newClassOption.collegeId) : null,
        grade: newClassOption.grade.trim(),
        major: newClassOption.major.trim(),
        className: newClassOption.className.trim(),
        counselorId: newClassOption.counselorId ? Number(newClassOption.counselorId) : null
      });
      cancelEditClassOption();
      await loadClassOptions();
      await loadCollegesData();
      const result = await apiService.fetchTeachers();
      onUpdateTeachers(result as any);
      setImportStatusMsg('注册专业班级及辅导员已更新。');
    } catch (e: any) { alert('更新失败: ' + (e.message || '请保留正确记录并删除重复项')); }
  };

  const assignClassCounselor = async (optionId: number) => {
    const counselorId = Number(classCounselorSelections[optionId] || 0);
    if (!counselorId) return alert('请选择辅导员');
    try {
      await apiService.assignClassOptionCounselor(optionId, counselorId);
      await loadClassOptions();
      const result = await apiService.fetchTeachers();
      onUpdateTeachers(result as any);
      setImportStatusMsg('专业班级辅导员已更新，对应年级学生信息已同步。');
    } catch (e: any) { alert('绑定失败: ' + (e.message || '请重试')); }
  };

  const removeClassOption = async (id: number) => {
    if (!isSuperAdmin) return;
    if (!confirm('确定删除该专业班级选项？已存在学生数据不会被删除。')) return;
    try {
      await apiService.deleteClassOption(id);
      setSelectedClassOptionIds(selectedClassOptionIds.filter(item => item !== id));
      if (editingClassOptionId === id) cancelEditClassOption();
      await loadClassOptions();
      await loadCollegesData();
      setImportStatusMsg('专业班级选项已从数据库删除。');
    } catch (e: any) { alert('删除失败: ' + (e.message || '请重试')); }
  };

  const toggleSelectedId = <T,>(value: T, selected: T[], setSelected: (next: T[]) => void) => {
    setSelected(selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]);
  };

  const toggleAllVisibleIds = <T,>(values: T[], selected: T[], setSelected: (next: T[]) => void) => {
    const allSelected = values.length > 0 && values.every(value => selected.includes(value));
    setSelected(allSelected ? selected.filter(item => !values.includes(item)) : Array.from(new Set([...selected, ...values])));
  };

  const deleteSelectedStudents = async () => {
    if (!isSuperAdmin || selectedStudentIds.length === 0 || isBatchDeleting) return;
    if (!confirm(`确定批量删除 ${selectedStudentIds.length} 条学生记录？`)) return;
    setIsBatchDeleting(true);
    try {
      await apiService.batchDeleteStudents(selectedStudentIds.map(id => Number(id)));
      setSelectedStudentIds([]);
      const res = await apiService.fetchStudents();
      onUpdateStudents(res as any);
      setImportStatusMsg('学生记录已批量删除。');
    } catch (e: any) {
      alert('批量删除失败: ' + (e.message || '请重试'));
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const deleteSelectedTeachers = async () => {
    if (!isSuperAdmin || selectedTeacherIds.length === 0 || isBatchDeleting) return;
    if (!confirm(`确定批量删除 ${selectedTeacherIds.length} 条教师记录？`)) return;
    setIsBatchDeleting(true);
    try {
      await apiService.batchDeleteTeachers(selectedTeacherIds.map(id => Number(id)));
      setSelectedTeacherIds([]);
      const res = await apiService.fetchTeachers();
      onUpdateTeachers(res as any);
      setImportStatusMsg('教师记录已批量删除。');
    } catch (e: any) {
      alert('批量删除失败: ' + (e.message || '请重试'));
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const deleteSelectedClassOptions = async () => {
    if (!isSuperAdmin || selectedClassOptionIds.length === 0 || isBatchDeleting) return;
    if (!confirm(`确定批量删除 ${selectedClassOptionIds.length} 条专业班级选项？`)) return;
    setIsBatchDeleting(true);
    try {
      await apiService.batchDeleteClassOptions(selectedClassOptionIds);
      setSelectedClassOptionIds([]);
      await loadClassOptions();
      await loadCollegesData();
      setImportStatusMsg('专业班级选项已批量删除。');
    } catch (e: any) {
      alert('批量删除失败: ' + (e.message || '请重试'));
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const parseClassNames = (value: string | string[] | undefined): string[] => {
    const raw = Array.isArray(value) ? value : String(value || '').split(/[,，、\s]+/);
    return Array.from(new Set(raw.map(cls => cls.trim()).filter(Boolean)));
  };

  // 批量导入兼容旧模板里只提供“专业班级”一列；手动新增统一从数据库班级选项选择。
  const deriveMajorFromClassName = (className: string): string => {
    const cleaned = String(className || '').trim();
    return cleaned.replace(/[0-9０-９一二三四五六七八九十]+班$/, '').trim() || cleaned;
  };

  const resolveCollegeId = (collegeName: string, source = collegesWithClasses): number => {
    const normalized = String(collegeName || '').replace(/\s+/g, '');
    const found = source.find(college =>
      String(college.name || '').replace(/\s+/g, '') === normalized ||
      String(college.code || '').replace(/\s+/g, '') === normalized ||
      String(college.id) === normalized
    );
    return found ? Number(found.id) : 1;
  };

  const hasMatchedCollege = (collegeName: string, source = collegesWithClasses): boolean => {
    const normalized = String(collegeName || '').replace(/\s+/g, '');
    if (!normalized) return false;
    return source.some(college =>
      String(college.name || '').replace(/\s+/g, '') === normalized ||
      String(college.code || '').replace(/\s+/g, '') === normalized ||
      String(college.id) === normalized
    );
  };

  const loadClassRequests = async () => {
    if (!isSuperAdmin) return;
    try {
      const result = await apiService.fetchClassRequests('pending');
      setClassRequests((result.requests || []) as ClassChangeRequest[]);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    if (isSuperAdmin) loadClassRequests();
    if (isCounselorOrAdmin) {
      loadCollegesData();
      if (isSuperAdmin) loadClassOptions();
    }
  }, [isSuperAdmin]);

  // Get classes for selected college
  const getClassesForCollege = (collegeId: string): string[] => {
    const found = collegesWithClasses.find(c => String(c.id) === collegeId);
    return found ? found.classes : [];
  };

  const getAllDatabaseClasses = (): string[] => {
    const fromOptions = classOptions.map(option => option.class_name).filter(Boolean);
    const fromColleges = collegesWithClasses.flatMap(college => college.classes || []);
    return Array.from(new Set([...fromOptions, ...fromColleges])).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  };

  const getClassOptionLabel = (option: typeof classOptions[number]) => {
    const parts = [option.grade, option.major, option.class_name].filter(Boolean);
    return `${parts.join(' · ')}${option.college_name ? `（${option.college_name}）` : ''}`;
  };

  const selectStudentClassOption = (optionId: string) => {
    const option = classOptions.find(item => String(item.id) === optionId);
    if (!option) {
      setNewStudent({ ...newStudent, classOptionId: optionId, grade: '', majorClass: '', college: '', counselorName: '' });
      return;
    }
    setNewStudent({
      ...newStudent,
      classOptionId: optionId,
      grade: option.grade || '',
      majorClass: option.class_name || '',
      college: option.college_name || '',
      counselorName: option.counselors?.[0]?.name || ''
    });
  };

  const openEditTeacherClasses = (teacher: TeacherRecord) => {
    closeAllDialogs();
    const classes = parseClassNames(teacher.classes);
    setEditTeacherId(teacher.id);
    setEditTeacherName(teacher.name);
    setEditTeacherClasses(classes.join(', '));
    setEditTeacherOriginalClasses(classes);
    setShowEditTeacherClasses(true);
    if (collegesWithClasses.length === 0) loadCollegesData();
  };

  const openEditTeacherGrade = (teacher: TeacherRecord) => {
    closeAllDialogs();
    setEditTeacherId(teacher.id);
    setEditTeacherName(teacher.name);
    setEditTeacherGrade(teacher.grade || '');
    setShowEditTeacherGrade(true);
  };

  const saveTeacherGrade = async () => {
    const grade = editTeacherGrade.trim();
    if (!grade) return alert('请填写管理年级，如 2024级');
    try {
      if (isSuperAdmin) {
        await apiService.updateTeacherGrade(editTeacherId, grade);
        setShowEditTeacherGrade(false);
        const res = await apiService.fetchTeachers();
        onUpdateTeachers(res as any);
        setImportStatusMsg('教师管理年级已保存。');
        return;
      }
      if (currentUser?.role !== 'counselor' || !myTeacher || editTeacherId !== myTeacher.id) {
        alert('辅导员只能为自己的管理年级提交变更申请');
        return;
      }
      await apiService.submitGradeRequest(grade, '辅导员申请变更管理年级');
      setShowEditTeacherGrade(false);
      setImportStatusMsg('年级变更申请已提交，等待管理员审核。');
    } catch (e: any) {
      alert((isSuperAdmin ? '保存失败: ' : '申请提交失败: ') + (e.message || '请重试'));
    }
  };

  const saveTeacherClasses = async () => {
    const classesArr = parseClassNames(editTeacherClasses);
    try {
      if (isSuperAdmin) {
        await apiService.updateTeacherClasses(editTeacherId, classesArr);
        setShowEditTeacherClasses(false);
        const res = await apiService.fetchTeachers();
        onUpdateTeachers(res as any);
        setImportStatusMsg('教师负责班级已保存。');
        return;
      }

      if (currentUser?.role !== 'counselor' || !myTeacher || editTeacherId !== myTeacher.id) {
        alert('辅导员只能为自己的负责班级提交变更申请');
        return;
      }

      const additions = classesArr.filter(cls => !editTeacherOriginalClasses.includes(cls));
      const removals = editTeacherOriginalClasses.filter(cls => !classesArr.includes(cls));
      if (additions.length === 0 && removals.length === 0) {
        alert('班级未发生变化');
        return;
      }

      await Promise.all([
        ...additions.map(cls => apiService.submitClassRequest('add', cls, '辅导员申请新增负责班级')),
        ...removals.map(cls => apiService.submitClassRequest('remove', cls, '辅导员申请移除负责班级'))
      ]);
      setShowEditTeacherClasses(false);
      setImportStatusMsg(`已提交 ${additions.length + removals.length} 条班级变更申请，等待管理员审核。`);
    } catch (e: any) {
      alert((isSuperAdmin ? '更新失败: ' : '申请提交失败: ') + (e.message || '请重试'));
    }
  };

  const reviewClassRequest = async (id: number, action: 'approve' | 'reject') => {
    try {
      await apiService.approveClassRequest(id, action);
      await loadClassRequests();
      const res = await apiService.fetchTeachers();
      onUpdateTeachers(res as any);
      setImportStatusMsg(action === 'approve' ? '变更申请已通过。' : '变更申请已拒绝。');
    } catch (e: any) {
      alert('审批失败: ' + (e.message || '请重试'));
    }
  };

  const deleteStudentRecord = async (student: StudentRecord) => {
    if (!isSuperAdmin) return alert('仅管理员可删除学生记录');
    if (!confirm(`确定删除学生 ${student.name}（${student.studentId}）？`)) return;
    try {
      await apiService.deleteStudent(Number(student.id));
      setSelectedStudentIds(selectedStudentIds.filter(id => id !== student.id));
      const res = await apiService.fetchStudents();
      onUpdateStudents(res as any);
      setImportStatusMsg('学生记录已删除。');
    } catch (e: any) {
      alert('删除失败: ' + (e.message || '请重试'));
    }
  };

  const deleteTeacherRecord = async (teacher: TeacherRecord) => {
    if (!isSuperAdmin) return alert('仅管理员可删除教师记录');
    if (!confirm(`确定删除教师 ${teacher.name}（${teacher.teacherId}）？`)) return;
    try {
      await apiService.deleteTeacher(Number(teacher.id));
      setSelectedTeacherIds(selectedTeacherIds.filter(id => id !== teacher.id));
      const res = await apiService.fetchTeachers();
      onUpdateTeachers(res as any);
      setImportStatusMsg('教师记录已删除。');
    } catch (e: any) {
      alert('删除失败: ' + (e.message || '请重试'));
    }
  };

  // Handle Teacher Add
  const handleAddTeacherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeacher.teacherId || !newTeacher.name) return;
    try {
      const classes = parseClassNames(newTeacher.classes);
      await apiService.createTeacher({
        employeeId: newTeacher.teacherId, name: newTeacher.name, grade: newTeacher.grade,
        collegeId: newTeacher.collegeId || newTeacher.college, classes,
        email: newTeacher.email || undefined,
        password: newTeacher.password || undefined
      });
      setShowAddTeacher(false);
      setNewTeacher({ teacherId: '', name: '', email: '', grade: '2025级', college: '', collegeId: '', title: '辅导员', classes: '', password: '' });
      const result = await apiService.fetchTeachers();
      onUpdateTeachers(result as any);
    } catch (e: any) { alert('添加失败: ' + (e.message || '请重试')); }
  };

  // Handle Student Excel Upload
  const handleStudentFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (!isSuperAdmin) return alert('仅管理员可批量导入学生');
      const data = await parseExcelFile(file);
      const importedStudents: Array<{ studentId: string; name: string; password?: string; grade: string; major: string; className: string; collegeId: number; gender?: string; counselorName?: string }> = [];
      const invalidRows: number[] = [];
      const duplicateIds: string[] = [];
      const unmatchedColleges = new Set<string>();
      const seenIds = new Set<string>();
      let exampleRows = 0;
      let collegeData = collegesWithClasses;
      if (collegeData.length === 0) {
        const res: any = await apiService.fetchCollegesClasses();
        collegeData = res.colleges || [];
        setCollegesWithClasses(collegeData);
      }

      data.forEach((row: any, index: number) => {
        const studentId = String(row['学号'] || row['studentId'] || '').trim();
        const name = String(row['姓名'] || row['name'] || '').trim();
        const grade = String(row['年级'] || row['grade'] || inferGradeFromStudentId(studentId) || '').trim();
        const majorClass = String(row['专业班级'] || row['majorClass'] || '未分配').trim();
        const major = String(row['专业'] || row['major'] || '').trim() || deriveMajorFromClassName(majorClass);
        const collegeName = String(row['学院'] || row['college'] || '').trim();
        const gender = String(row['性别'] || row['gender'] || '').trim();
        const password = String(row['密码'] || row['password'] || '').trim();
        const counselorName = String(row['辅导员姓名'] || row['counselorName'] || '').trim();

        if (isExampleImportRow([studentId, name, grade, majorClass, major, collegeName, gender, password, counselorName])) {
          exampleRows += 1;
          return;
        }
        if (!studentId || !name || !grade) {
          invalidRows.push(index + 2);
          return;
        }
        if (seenIds.has(studentId)) duplicateIds.push(studentId);
        seenIds.add(studentId);
        if (collegeName && !hasMatchedCollege(collegeName, collegeData)) unmatchedColleges.add(collegeName);
        importedStudents.push({
          studentId,
          name,
          grade,
          password: password || undefined,
          major,
          className: majorClass,
          collegeId: resolveCollegeId(collegeName, collegeData),
          gender,
          counselorName
        });
      });

      if (importedStudents.length > 0) {
        const warnings = [
          invalidRows.length ? `跳过 ${invalidRows.length} 行缺少学号/姓名的数据（行号：${invalidRows.slice(0, 8).join('、')}）` : '',
          duplicateIds.length ? `文件内有 ${duplicateIds.length} 个重复学号，会以后出现的数据为准：${duplicateIds.slice(0, 8).join('、')}` : '',
          unmatchedColleges.size ? `有 ${unmatchedColleges.size} 个学院未匹配数据库，将使用默认学院：${Array.from(unmatchedColleges).slice(0, 5).join('、')}` : '',
        ].filter(Boolean);
        if (warnings.length > 0 && !confirm(`学生导入预检查发现：\n${warnings.join('\n')}\n\n是否继续导入有效数据？`)) {
          setImportStatusMsg('已取消导入。预检查发现：' + warnings.join('；'));
          return;
        }
        const importResult: any = await apiService.importStudents(importedStudents);
        const result = await apiService.fetchStudents();
        onUpdateStudents(result as any);
        const serverFailure = importResult.failedCount
          ? `；服务端另有 ${importResult.failedCount} 条失败：${(importResult.failed || []).slice(0, 3).map((item: any) => `第${item.row}行 ${item.error}`).join('；')}`
          : '';
        const exampleRowsMsg = exampleRows ? `；已自动跳过 ${exampleRows} 条模板示例行` : '';
        setImportStatusMsg(`预检查完成：有效 ${importedStudents.length} 条，跳过 ${invalidRows.length} 条${exampleRowsMsg}。成功导入/更新 ${importResult.count ?? importedStudents.length} 条学生数据${serverFailure}。${warnings.length ? ' 注意：' + warnings.join('；') : ''}`);
      } else {
        setImportStatusMsg(exampleRows ? `只读取到 ${exampleRows} 条模板示例行，已自动跳过。请删除“示例：”前缀并填写真实学生后再导入。` : '未能在文件里读取到有效的学生记录，请使用指定模板。');
      }
    } catch (err: any) {
      setImportStatusMsg('学生导入失败：' + (err.message || '请确认格式是否正确。'));
    }
  };

  // Handle Teacher Excel Upload
  const handleTeacherFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (!isSuperAdmin) return alert('仅管理员可批量导入教师');
      const data = await parseExcelFile(file);
      const importedTeachers: Array<{ employeeId: string; name: string; email?: string; password?: string; grade: string; collegeId: number; classes: string[] }> = [];
      const invalidRows: number[] = [];
      const duplicateIds: string[] = [];
      const unmatchedColleges = new Set<string>();
      const emptyClassRows: number[] = [];
      const seenIds = new Set<string>();
      let exampleRows = 0;
      let collegeData = collegesWithClasses;
      if (collegeData.length === 0) {
        const res: any = await apiService.fetchCollegesClasses();
        collegeData = res.colleges || [];
        setCollegesWithClasses(collegeData);
      }

      data.forEach((row: any, index: number) => {
        const teacherId = String(row['工号'] || row['teacherId'] || '').trim();
        const name = String(row['姓名'] || row['name'] || '').trim();
        const grade = String(row['年级'] || row['grade'] || '2025级').trim();
        const collegeName = String(row['学院'] || row['college'] || '').trim();
        const classes = parseClassNames(String(row['负责班级'] || row['classes'] || ''));
        const email = String(row['邮箱'] || row['email'] || '').trim();
        const password = String(row['密码'] || row['password'] || '').trim();

        if (isExampleImportRow([teacherId, name, grade, collegeName, classes.join(','), email, password])) {
          exampleRows += 1;
          return;
        }
        if (!teacherId || !name) {
          invalidRows.push(index + 2);
          return;
        }
        if (seenIds.has(teacherId)) duplicateIds.push(teacherId);
        seenIds.add(teacherId);
        if (collegeName && !hasMatchedCollege(collegeName, collegeData)) unmatchedColleges.add(collegeName);
        if (classes.length === 0) emptyClassRows.push(index + 2);
        importedTeachers.push({
          employeeId: teacherId,
          name,
          email: email || undefined,
          password: password || undefined,
          grade,
          collegeId: resolveCollegeId(collegeName, collegeData),
          classes
        });
      });

      if (importedTeachers.length > 0) {
        const warnings = [
          invalidRows.length ? `跳过 ${invalidRows.length} 行缺少工号/姓名的数据（行号：${invalidRows.slice(0, 8).join('、')}）` : '',
          duplicateIds.length ? `文件内有 ${duplicateIds.length} 个重复工号，会以后出现的数据为准：${duplicateIds.slice(0, 8).join('、')}` : '',
          unmatchedColleges.size ? `有 ${unmatchedColleges.size} 个学院未匹配数据库，将使用默认学院：${Array.from(unmatchedColleges).slice(0, 5).join('、')}` : '',
          emptyClassRows.length ? `${emptyClassRows.length} 行未填写负责班级（行号：${emptyClassRows.slice(0, 8).join('、')}），导入后需再分配班级` : '',
        ].filter(Boolean);
        if (warnings.length > 0 && !confirm(`教师导入预检查发现：\n${warnings.join('\n')}\n\n是否继续导入有效数据？`)) {
          setImportStatusMsg('已取消导入。预检查发现：' + warnings.join('；'));
          return;
        }
        const importResult: any = await apiService.importTeachers(importedTeachers);
        const result = await apiService.fetchTeachers();
        onUpdateTeachers(result as any);
        const serverFailure = importResult.failedCount
          ? `；服务端另有 ${importResult.failedCount} 条失败：${(importResult.failed || []).slice(0, 3).map((item: any) => `第${item.row}行 ${item.error}`).join('；')}`
          : '';
        const exampleRowsMsg = exampleRows ? `；已自动跳过 ${exampleRows} 条模板示例行` : '';
        setImportStatusMsg(`预检查完成：有效 ${importedTeachers.length} 条，跳过 ${invalidRows.length} 条${exampleRowsMsg}。成功导入/更新 ${importResult.count ?? importedTeachers.length} 条教师数据${serverFailure}。${warnings.length ? ' 注意：' + warnings.join('；') : ''}`);
      } else {
        setImportStatusMsg(exampleRows ? `只读取到 ${exampleRows} 条模板示例行，已自动跳过。请删除“示例：”前缀并填写真实教师后再导入。` : '未读取到有效教师记录，请参照模板。');
      }
    } catch (err: any) {
      setImportStatusMsg('教师导入失败：' + (err.message || '请重新检查。'));
    }
  };

  const handleClassOptionFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      if (!isSuperAdmin) return alert('仅管理员可批量导入班级');
      const data = await parseExcelFile(file);
      const importedOptions: Array<{ collegeId?: number | null; grade: string; major: string; className: string; counselorEmployeeId?: string; counselorName?: string }> = [];
      const invalidRows: number[] = [];
      const duplicateKeys: string[] = [];
      const unmatchedColleges = new Set<string>();
      const seenKeys = new Set<string>();
      let exampleRows = 0;
      let collegeData = collegesWithClasses;
      if (collegeData.length === 0) {
        const res: any = await apiService.fetchCollegesClasses();
        collegeData = res.colleges || [];
        setCollegesWithClasses(collegeData);
      }

      data.forEach((row: any, index: number) => {
        const collegeName = String(row['学院'] || row['college'] || row['collegeName'] || '').trim();
        const grade = String(row['年级'] || row['grade'] || '').trim();
        const major = String(row['专业'] || row['major'] || '').trim();
        const className = String(row['班级'] || row['专业班级'] || row['className'] || row['class_name'] || '').trim();
        const counselorEmployeeId = String(row['辅导员工号（可选）'] || row['辅导员工号'] || row['counselorEmployeeId'] || row['counselor_employee_id'] || '').trim();
        const counselorName = String(row['辅导员姓名（可选）'] || row['辅导员姓名'] || row['counselorName'] || row['counselor_name'] || '').trim();

        if (isExampleImportRow([collegeName, grade, major, className, counselorEmployeeId, counselorName])) {
          exampleRows += 1;
          return;
        }
        if (!grade || !major || !className) {
          invalidRows.push(index + 2);
          return;
        }
        const key = `${normalizeGrade(grade)}|${normalizeClassText(major)}|${normalizeClassText(className)}`;
        if (seenKeys.has(key)) duplicateKeys.push(`${grade}/${major}/${className}`);
        seenKeys.add(key);
        if (collegeName && !hasMatchedCollege(collegeName, collegeData)) unmatchedColleges.add(collegeName);
        importedOptions.push({
          collegeId: collegeName ? resolveCollegeId(collegeName, collegeData) : null,
          grade,
          major,
          className,
          counselorEmployeeId: counselorEmployeeId || undefined,
          counselorName: counselorName || undefined
        });
      });

      if (importedOptions.length === 0) {
        if (exampleRows > 0) {
          setImportStatusMsg(`只读取到 ${exampleRows} 条模板示例行，已自动跳过。请删除“示例：”前缀并填写真实班级后再导入。`);
          return;
        }
        setImportStatusMsg('未读取到有效班级记录，请使用班级管理导入模板。');
        return;
      }

      const warnings = [
        invalidRows.length ? `跳过 ${invalidRows.length} 行缺少年级/专业/班级的数据（行号：${invalidRows.slice(0, 8).join('、')}）` : '',
        duplicateKeys.length ? `文件内有 ${duplicateKeys.length} 条重复班级，会以后出现的数据为准：${duplicateKeys.slice(0, 5).join('、')}` : '',
        unmatchedColleges.size ? `有 ${unmatchedColleges.size} 个学院未匹配数据库，将按默认学院或空学院处理：${Array.from(unmatchedColleges).slice(0, 5).join('、')}` : '',
      ].filter(Boolean);
      if (warnings.length > 0 && !confirm(`班级导入预检查发现：\n${warnings.join('\n')}\n\n是否继续导入有效数据？`)) {
        setImportStatusMsg('已取消导入。预检查发现：' + warnings.join('；'));
        return;
      }

      const importResult = await apiService.importClassOptions(importedOptions);
      await loadClassOptions();
      await loadCollegesData();
      const teacherResult = await apiService.fetchTeachers();
      onUpdateTeachers(teacherResult as any);
      const counselorFailedMsg = importResult.counselorFailed ? `；${importResult.counselorFailed} 条辅导员未绑定，请核对工号、姓名或管理年级` : '';
      const exampleRowsMsg = exampleRows ? `；已自动跳过 ${exampleRows} 条模板示例行` : '';
      setImportStatusMsg(`成功导入/更新 ${importResult.count ?? importedOptions.length} 条班级记录；绑定辅导员 ${importResult.counselorBound ?? 0} 条${counselorFailedMsg}${exampleRowsMsg}。${warnings.length ? ' 注意：' + warnings.join('；') : ''}`);
    } catch (err: any) {
      setImportStatusMsg('班级导入失败：' + (err.message || '请确认模板格式是否正确。'));
    }
  };

  const handleAddStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudent.studentId || !newStudent.name) return;
    if (!isSuperAdmin) return alert('仅管理员可新增学生');
    const selectedOption = classOptions.find(item => String(item.id) === newStudent.classOptionId);
    if (!selectedOption) return alert('请选择数据库中已有的专业班级；暂无班级时请先在“登录注册班级管理”中新增。');

    try {
      let collegeData = collegesWithClasses;
      if (collegeData.length === 0) {
        const res: any = await apiService.fetchCollegesClasses();
        collegeData = res.colleges || [];
        setCollegesWithClasses(collegeData);
      }
      await apiService.createStudent({
        studentId: newStudent.studentId,
        name: newStudent.name,
        password: newStudent.password || undefined,
        grade: selectedOption.grade,
        major: selectedOption.major || deriveMajorFromClassName(selectedOption.class_name),
        className: selectedOption.class_name,
        collegeId: selectedOption.college_id || resolveCollegeId(selectedOption.college_name || newStudent.college, collegeData),
        gender: newStudent.gender,
        counselorName: selectedOption.counselors?.[0]?.name || newStudent.counselorName
      });
      setShowAddStudent(false);
      setNewStudent({
        studentId: '',
        name: '',
        password: '',
        grade: '',
        majorClass: '',
        classOptionId: '',
        college: '',
        gender: '男',
        counselorName: ''
      });
      const result = await apiService.fetchStudents();
      onUpdateStudents(result as any);
      setImportStatusMsg('学生记录已添加。');
    } catch (e: any) {
      alert('添加失败: ' + (e.message || '请重试'));
    }
  };


  const classesList = Array.from(new Set(students.map(s => s.majorClass)));

  const filteredStudents = students.filter(s => {
    const matchesQuery = fieldHit(searchQuery, [s.name, s.studentId, s.grade, s.majorClass, s.college, s.gender], false);
    const matchesClass = selectedClass === 'all' || normalizeClassText(s.majorClass) === normalizeClassText(selectedClass);
    return matchesQuery && matchesClass;
  });

  const filteredTeachers = teachers.filter(t => fieldHit(searchQuery, [t.name, t.teacherId, t.email, t.grade, t.title, t.college, Array.isArray((t as any).classes) ? (t as any).classes.join('、') : (t as any).classes], false));
  const visibleStudentIds = filteredStudents.map(student => student.id);
  const visibleTeacherIds = filteredTeachers.map(teacher => teacher.id);
  const visibleClassOptionIds = classOptions.map(option => option.id);
  const allVisibleStudentsSelected = visibleStudentIds.length > 0 && visibleStudentIds.every(id => selectedStudentIds.includes(id));
  const allVisibleTeachersSelected = visibleTeacherIds.length > 0 && visibleTeacherIds.every(id => selectedTeacherIds.includes(id));
  const allVisibleClassOptionsSelected = visibleClassOptionIds.length > 0 && visibleClassOptionIds.every(id => selectedClassOptionIds.includes(id));

  const myTeacher = isCounselorOrAdmin && currentUser?.role === 'counselor' ? teachers.find((t: any) => {
    const tid = String(t.teacherId || t.employee_id || '');
    const uid = String(currentUser.studentId || currentUser.username || '');
    return tid === uid || t.teacherId === uid;
  }) : null;
  const myClasses = myTeacher ? ((myTeacher as any).classes || []) : [];

  return (
    <div className="space-y-6">
      {/* 辅导员专属：快速管理负责班级 */}
      {currentUser?.role === 'counselor' && (
        <div className="bg-gradient-to-r from-blue-50 to-amber-50 dark:from-blue-950/40 dark:to-amber-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl p-5">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="min-w-0">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <ClipboardList className="w-4 h-4 text-blue-600" />
                <span className="min-w-0">班级管理（变更申请）</span>
              </h3>
              <p className="text-xs text-slate-500 mt-1">当前负责班级如下；新增、删除、修改负责班级都需要提交申请，管理员审核后生效。</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {myClasses.length === 0 ? (
                  <span className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 rounded-full font-semibold">未分配班级，请在教师列表中找到自己并编辑</span>
                ) : (
                  myClasses.map((cls: string) => (
                    <span key={cls} className="text-xs bg-blue-600 text-white px-3 py-1 rounded-full font-semibold">{cls}</span>
                  ))
                )}
              </div>
            </div>
            <button
              onClick={() => { setActiveSubTab('teachers'); }}
              className="w-full rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md sm:w-auto shrink-0"
            >
              前往教师列表提交申请 →
            </button>
          </div>
        </div>
      )}

      {/* Top Banner & SubTab Navigation */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/70 dark:border-slate-800/70 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="flex min-w-0 items-start gap-2 text-lg font-bold text-slate-900 dark:text-white sm:items-center">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
              <span className="min-w-0">师生数据与班级名单管理</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              按模板导入教师（工号/姓名/邮箱/密码/负责班级）及学生（学号/姓名/密码/专业班级/辅导员），支持增删与过滤。
            </p>
          </div>

          <div className="flex max-w-full items-center overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
            <button
              onClick={() => setActiveSubTab('students')}
              className={`shrink-0 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeSubTab === 'students'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              学生名单 ({students.length})
            </button>
            <button
              onClick={() => setActiveSubTab('teachers')}
              className={`shrink-0 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeSubTab === 'teachers'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              教师/辅导员名单 ({teachers.length})
            </button>
            <button
              onClick={() => { loadAssistants(); setActiveSubTab('assistants'); }}
              className={`shrink-0 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                activeSubTab === 'assistants'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              班委管理
            </button>
            {currentUser?.role === 'admin' && (
              <button
                onClick={() => { loadCollegeAdmins(); setActiveSubTab('collegeAdmins'); }}
                className={`shrink-0 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${activeSubTab === 'collegeAdmins' ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}`}
              >
                二级管理员
              </button>
            )}
            {isSuperAdmin && (
              <button
                onClick={() => { loadClassOptions(); setActiveSubTab('classOptions'); }}
                className={`shrink-0 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                  activeSubTab === 'classOptions'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                班级管理
              </button>
            )}
          </div>
        </div>

        {/* Status Message Alert */}
        {importStatusMsg && (
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 rounded-xl text-xs text-blue-700 dark:text-blue-300 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
              <span className="min-w-0">{importStatusMsg}</span>
            </div>
            <button onClick={() => setImportStatusMsg('')} className="text-blue-600 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200 shrink-0">
              关闭
            </button>
          </div>
        )}
      </div>

      {currentUser?.role === 'admin' && classRequests.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="min-w-0 text-sm font-bold text-slate-900 dark:text-white">年级/班级变更待审批 ({classRequests.length})</h3>
            <button onClick={loadClassRequests} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs rounded-xl">
              刷新
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {classRequests.map(req => (
              <div key={req.id} className="py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
                  <span className="font-bold text-slate-900 dark:text-white">{req.teacher_name}</span>
                  <span className="mx-2">
                    {req.request_type === 'grade' ? '申请变更管理年级为' : req.action === 'add' ? '申请新增负责班级' : '申请移除负责班级'}
                  </span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">{req.request_type === 'grade' ? req.grade : req.class_name}</span>
                  {req.reason && <span className="ml-3 text-slate-400">{req.reason}</span>}
                </div>
                <div className="flex w-full items-center justify-end gap-2 md:w-auto shrink-0">
                  <button onClick={() => reviewClassRequest(req.id, 'reject')} className="px-3 py-1.5 bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900 text-xs font-semibold rounded-xl">
                    拒绝
                  </button>
                  <button onClick={() => reviewClassRequest(req.id, 'approve')} className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-xl">
                    通过
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Bar */}
      {activeSubTab !== 'classOptions' && <div className="flex flex-col items-stretch justify-between gap-3 lg:flex-row lg:items-center">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 sm:max-w-xl">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder={activeSubTab === 'students' ? "搜索学号、姓名、年级、班级..." : "搜索工号、姓名、班级..."}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {activeSubTab === 'students' && (
            <select
              value={selectedClass}
              onChange={e => setSelectedClass(e.target.value)}
              className="w-full sm:w-auto px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">所有班级</option>
              {classesList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center lg:justify-end">
          {activeSubTab === 'students' ? (
            <>
              <button
                onClick={() => exportStudentRosterExcel(filteredStudents, `学生名册_${selectedClass === 'all' ? '全校' : selectedClass}.xlsx`)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>导出学生名册 Excel</span>
              </button>

              <button
                onClick={downloadStudentImportTemplate}
                disabled={!isSuperAdmin}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载学生模板</span>
              </button>

              {isSuperAdmin ? (
                <>
                  <label className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-500 bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 dark:border-blue-800 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>批量导入学生</span>
                    <input
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleStudentFileUpload}
                      className="hidden"
                    />
                  </label>

                  <button
                    onClick={openAddStudentDialog}
                    className="flex items-center justify-center gap-1 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>单条添加</span>
                  </button>

                  <button
                    onClick={deleteSelectedStudents}
                    disabled={selectedStudentIds.length === 0 || isBatchDeleting}
                    className="flex items-center justify-center gap-1 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-rose-600/20 transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none dark:disabled:bg-slate-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>批量删除({selectedStudentIds.length})</span>
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400">
                  <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>学生增删导入限管理员权限</span>
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => exportTeacherRosterExcel(filteredTeachers, '教师名册.xlsx')}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>导出教师名册 Excel</span>
              </button>

              {isSuperAdmin ? (
                <>
                  <button
                    onClick={downloadTeacherImportTemplate}
                    className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>下载教师模板</span>
                  </button>

                  <label className="flex items-center justify-center gap-1.5 rounded-xl border border-blue-500 bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700 dark:border-blue-800 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>批量导入教师</span>
                    <input
                      type="file"
                      accept=".xlsx, .xls, .csv"
                      onChange={handleTeacherFileUpload}
                      className="hidden"
                    />
                  </label>

                  <button
                    onClick={openAddTeacherDialog}
                    className="flex items-center justify-center gap-1 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-blue-600/20 transition-colors hover:bg-blue-700 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>单条添加</span>
                  </button>

                  <button
                    onClick={deleteSelectedTeachers}
                    disabled={selectedTeacherIds.length === 0 || isBatchDeleting}
                    className="flex items-center justify-center gap-1 rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md shadow-rose-600/20 transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none dark:disabled:bg-slate-700"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>批量删除({selectedTeacherIds.length})</span>
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400">
                  <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>教师/管理员添加限超级管理员权限</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>}

      {/* Main Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {activeSubTab === 'classOptions' ? (
          <div className="p-5 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">登录注册班级管理</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">统一维护学院、年级、专业、班级；辅导员可后续绑定。注册与权限匹配均以这些数据库资料为准。</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center lg:justify-end">
                <button onClick={downloadClassOptionImportTemplate} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                  <Download className="h-3.5 w-3.5" />
                  <span>下载班级模板</span>
                </button>
                <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                  <Upload className="h-3.5 w-3.5" />
                  <span>批量导入班级</span>
                  <input
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleClassOptionFileUpload}
                    className="hidden"
                  />
                </label>
                <button onClick={deleteSelectedClassOptions} disabled={selectedClassOptionIds.length === 0 || isBatchDeleting} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700">
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>批量删除({selectedClassOptionIds.length})</span>
                </button>
                {editingClassOptionId && <button onClick={cancelEditClassOption} className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"><X className="h-3.5 w-3.5" /><span>取消编辑</span></button>}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-6 dark:border-slate-700 dark:bg-slate-800/50">
              <select value={newClassOption.collegeId} onChange={e => setNewClassOption({ ...newClassOption, collegeId: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="">默认学院</option>{collegesWithClasses.map(col => <option key={col.id} value={col.id}>{col.name}</option>)}</select>
              <div className="relative"><input value={gradeYearInput(newClassOption.grade)} onChange={e => setNewClassOption({ ...newClassOption, grade: gradeYearInput(e.target.value) })} inputMode="numeric" maxLength={4} placeholder="年级，如2024" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-8 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" /><span className="pointer-events-none absolute right-3 top-2 text-xs font-semibold text-slate-500 dark:text-slate-400">级</span></div>
              <input value={newClassOption.major} onChange={e => setNewClassOption({ ...newClassOption, major: e.target.value })} placeholder="专业，如物联网工程" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
              <input value={newClassOption.className} onChange={e => setNewClassOption({ ...newClassOption, className: e.target.value })} placeholder="班级，如物联网工程1班" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
              <select value={newClassOption.counselorId} onChange={e => setNewClassOption({ ...newClassOption, counselorId: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"><option value="">辅导员（可选）</option>{teachers.filter(teacher => !newClassOption.grade || normalizeGrade(teacher.grade) === normalizeGrade(newClassOption.grade)).map(teacher => <option key={teacher.id} value={teacher.id} disabled={!teacher.grade}>{teacher.name}{teacher.grade ? ` · ${teacher.grade}` : ' · 未设置年级'}</option>)}</select>
              <button onClick={editingClassOptionId ? updateClassOption : saveClassOption} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">{editingClassOptionId ? '保存修改' : '新增班级'}</button>
            </div>
            {classOptions.length === 0 ? <p className="py-8 text-center text-xs text-slate-400">暂无可供登录注册选择的专业班级</p> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-3 py-3"><input type="checkbox" checked={allVisibleClassOptionsSelected} onChange={() => toggleAllVisibleIds(visibleClassOptionIds, selectedClassOptionIds, setSelectedClassOptionIds)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" title="全选当前班级" /></th><th className="px-3 py-3">学院</th><th className="px-3 py-3">年级</th><th className="px-3 py-3">专业</th><th className="px-3 py-3">班级</th><th className="px-3 py-3">注册可选辅导员</th><th className="px-3 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{classOptions.map(option => <tr key={option.id}><td className="px-3 py-3"><input type="checkbox" checked={selectedClassOptionIds.includes(option.id)} onChange={() => toggleSelectedId(option.id, selectedClassOptionIds, setSelectedClassOptionIds)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" /></td><td className="px-3 py-3 text-slate-500 dark:text-slate-400">{option.college_name || '默认学院'}</td><td className="px-3 py-3 font-medium text-slate-800 dark:text-slate-100">{option.grade}</td><td className="px-3 py-3 font-medium text-slate-800 dark:text-slate-100">{option.major}</td><td className="px-3 py-3 font-semibold text-blue-600 dark:text-blue-400">{option.class_name}</td><td className="px-3 py-3">{option.counselors?.length ? option.counselors.map(item => `${item.name}（${item.grade || '未设置年级'}）`).join('、') : '未绑定'}</td><td className="px-3 py-3"><div className="flex justify-end gap-2"><button onClick={() => beginEditClassOption(option)} title="编辑" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950"><Pencil className="h-3.5 w-3.5" /></button><button onClick={() => removeClassOption(option.id)} title="删除" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"><Trash2 className="h-3.5 w-3.5" /></button></div></td></tr>)}</tbody></table></div>
            )}
          </div>
        ) : activeSubTab === 'collegeAdmins' ? (
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 xl:grid-cols-5 dark:border-slate-700 dark:bg-slate-800/50">
              <input value={newCollegeAdmin.account} onChange={e => setNewCollegeAdmin({ ...newCollegeAdmin, account: e.target.value })} placeholder="登录账号" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              <input value={newCollegeAdmin.name} onChange={e => setNewCollegeAdmin({ ...newCollegeAdmin, name: e.target.value })} placeholder="姓名" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              <select value={newCollegeAdmin.collegeId} onChange={e => setNewCollegeAdmin({ ...newCollegeAdmin, collegeId: e.target.value })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900"><option value="">选择学院</option>{collegesWithClasses.map(col => <option key={col.id} value={col.id}>{col.name}</option>)}</select>
              <input value={newCollegeAdmin.email} onChange={e => setNewCollegeAdmin({ ...newCollegeAdmin, email: e.target.value })} placeholder="邮箱（可选）" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              <input value={newCollegeAdmin.password} onChange={e => setNewCollegeAdmin({ ...newCollegeAdmin, password: e.target.value })} placeholder="初始密码（可选）" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900" />
              <button onClick={createCollegeAdmin} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 sm:col-span-2 xl:col-span-1">创建二级管理员</button>
            </div>
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-xs"><thead className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><tr><th className="px-3 py-3">账号</th><th className="px-3 py-3">姓名</th><th className="px-3 py-3">学院</th><th className="px-3 py-3">邮箱</th><th className="px-3 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{collegeAdmins.map(item => <tr key={item.id}><td className="px-3 py-3 font-mono">{item.account}</td><td className="px-3 py-3">{item.name}</td><td className="px-3 py-3">{item.college_name || '-'}</td><td className="px-3 py-3">{item.email || '-'}</td><td className="px-3 py-3 text-right"><button onClick={() => deleteCollegeAdmin(item.id)} className="rounded-lg bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-300">停用</button></td></tr>)}</tbody></table></div>
          </div>
        ) : activeSubTab === 'assistants' ? (
          <div className="p-5 space-y-4">
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">学生学号</label>
                <input type="text" value={assistantStudentId} onChange={e => setAssistantStudentId(e.target.value)} placeholder="如 24170025" className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs" />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">负责班级（可选）</label>
                <select
                  value={assistantClassName}
                  onChange={e => setAssistantClassName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs text-slate-900 dark:text-white"
                >
                  <option value="">{getAllDatabaseClasses().length === 0 ? '暂无数据库班级选项' : '按学生原班级'}</option>
                  {getAllDatabaseClasses().map(cls => <option key={cls} value={cls}>{cls}</option>)}
                </select>
              </div>
              <button onClick={promoteAssistant} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-bold text-white hover:bg-blue-700 sm:w-auto">
                <ArrowUp className="w-3.5 h-3.5" />
                <span>提升为班委</span>
              </button>
            </div>
            <p className="text-xs text-slate-500">💡 该学生需已登录过系统。提升后退出重登即可看到班委审核功能。</p>
            <div className="border-t pt-4">
              <h4 className="text-sm font-bold mb-3 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500" />当前班委列表</h4>
              {assistantList.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-8">暂无班委，请在上方输入学号提为班委</p>
              ) : (
                <table className="w-full text-xs"><thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 uppercase"><tr><th className="px-3 py-2 text-left">学号</th><th className="px-3 py-2 text-left">姓名</th><th className="px-3 py-2 text-left">班级</th><th className="px-3 py-2 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{assistantList.map(a => <tr key={a.student_id}><td className="px-3 py-2 font-mono">{a.student_id}</td><td className="px-3 py-2">{a.name}</td><td className="px-3 py-2">{a.class_name || '-'}</td><td className="px-3 py-2 text-right"><button onClick={() => demoteAssistant(a.student_id)} className="px-3 py-1 bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 rounded-lg text-xs font-semibold">降级</button></td></tr>)}</tbody></table>
              )}
            </div>
          </div>
        ) : activeSubTab === 'students' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 uppercase font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  {isSuperAdmin && <th className="px-4 py-3"><input type="checkbox" checked={allVisibleStudentsSelected} onChange={() => toggleAllVisibleIds(visibleStudentIds, selectedStudentIds, setSelectedStudentIds)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" title="全选当前学生" /></th>}
                  <th className="px-4 py-3">序号</th>
                  <th className="px-4 py-3">学号</th>
                  <th className="px-4 py-3">姓名</th>
                  <th className="px-4 py-3">年级</th>
                  <th className="px-4 py-3">专业班级</th>
                  <th className="px-4 py-3">所属学院</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                      未检索到匹配的学生记录
                    </td>
                  </tr>
                ) : (
                  filteredStudents.map((student, idx) => (
                    <tr key={student.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      {isSuperAdmin && <td className="px-4 py-3"><input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleSelectedId(student.id, selectedStudentIds, setSelectedStudentIds)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" /></td>}
                      <td className="px-4 py-3 font-mono text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white font-mono">
                        {student.studentId}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {student.name}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {student.grade}
                      </td>
                      <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">
                        {student.majorClass}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {student.college}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isSuperAdmin && (
                          <button
                            onClick={() => deleteStudentRecord(student)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                            title="删除记录"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 uppercase font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  {isSuperAdmin && <th className="px-4 py-3"><input type="checkbox" checked={allVisibleTeachersSelected} onChange={() => toggleAllVisibleIds(visibleTeacherIds, selectedTeacherIds, setSelectedTeacherIds)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" title="全选当前教师" /></th>}
                  <th className="px-4 py-3">序号</th>
                  <th className="px-4 py-3">工号</th>
                  <th className="px-4 py-3">姓名</th>
                  <th className="px-4 py-3">邮箱</th>
                  <th className="px-4 py-3">带班/年级</th>
                  <th className="px-4 py-3">职称</th>
                  <th className="px-4 py-3">学院</th>
                  <th className="px-4 py-3">负责班级</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTeachers.length === 0 ? (
                  <tr>
                    <td colSpan={isSuperAdmin ? 10 : 9} className="px-4 py-8 text-center text-slate-400">
                      未检索到匹配的教师记录
                    </td>
                  </tr>
                ) : (
                  filteredTeachers.map((teacher, idx) => (
                    <tr key={teacher.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      {isSuperAdmin && <td className="px-4 py-3"><input type="checkbox" checked={selectedTeacherIds.includes(teacher.id)} onChange={() => toggleSelectedId(teacher.id, selectedTeacherIds, setSelectedTeacherIds)} className="rounded border-slate-300 text-rose-600 focus:ring-rose-500" /></td>}
                      <td className="px-4 py-3 font-mono text-slate-400">{idx + 1}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white font-mono">
                        {teacher.teacherId}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                        {teacher.name}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {teacher.email || '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                        {teacher.grade}
                      </td>
                      <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">
                        {teacher.title}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                        {teacher.college}
                      </td>
                      <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                        {(teacher as any).classes ? (Array.isArray((teacher as any).classes) ? (teacher as any).classes.join('、') : (teacher as any).classes) : '-'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                        {(isSuperAdmin || (currentUser?.role === 'counselor' && myTeacher?.id === teacher.id)) && (
                          <>
                            <button onClick={() => openEditTeacherGrade(teacher)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40" title={isSuperAdmin ? '编辑管理年级' : '提交年级变更申请'}>
                              <span className="text-[11px] font-bold">级</span>
                            </button>
                            <button onClick={() => openEditTeacherClasses(teacher)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/40" title={isSuperAdmin ? '编辑班级' : '提交班级变更申请'}>
                              <ClipboardList className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {isSuperAdmin && (
                          <button onClick={() => deleteTeacherRecord(teacher)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 cursor-pointer" title="删除记录"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual Add Student Modal */}
      {showAddStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 shadow-2xl space-y-4 my-2 sm:my-8">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">单条新增学生</h3>
            <form onSubmit={handleAddStudentSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">学号</label>
                <input
                  type="text"
                  required
                  placeholder="如: 2025010106"
                  value={newStudent.studentId}
                  onChange={e => setNewStudent({ ...newStudent, studentId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">姓名</label>
                <input
                  type="text"
                  required
                  placeholder="学生姓名"
                  value={newStudent.name}
                  onChange={e => setNewStudent({ ...newStudent, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">邮箱</label>
                <input
                  type="email"
                  placeholder="用于验证码、忘记密码和修改密码"
                  value={newTeacher.email}
                  onChange={e => setNewTeacher({ ...newTeacher, email: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">初始密码</label>
                <input
                  type="text"
                  placeholder="不填则使用系统默认密码"
                  value={newStudent.password}
                  onChange={e => setNewStudent({ ...newStudent, password: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">年级</label>
                  <input
                    type="text"
                    readOnly
                    value={newStudent.grade}
                    placeholder="选择专业班级后自动带出"
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">专业班级</label>
                  <select
                    required
                    value={newStudent.classOptionId}
                    onChange={e => selectStudentClassOption(e.target.value)}
                    disabled={classOptions.length === 0}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white disabled:text-slate-400"
                  >
                    <option value="">{classOptions.length === 0 ? '暂无数据库班级选项' : '请选择专业班级'}</option>
                    {classOptions.map(option => (
                      <option key={option.id} value={option.id}>{getClassOptionLabel(option)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">辅导员姓名</label>
                  <input
                    type="text"
                    readOnly
                    value={newStudent.counselorName}
                    placeholder="未绑定辅导员时为空"
                    className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">学院</label>
                <input
                  type="text"
                  readOnly
                  value={newStudent.college}
                  placeholder="选择专业班级后自动带出"
                  className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-200"
                />
              </div>

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddStudent(false)}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs rounded-xl"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl"
                >
                  保存添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Add Teacher Modal */}
      {showAddTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 shadow-2xl space-y-4 my-2 sm:my-8">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">新增教师/辅导员</h3>
            <form onSubmit={handleAddTeacherSubmit} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">工号</label>
                  <input type="text" required placeholder="如 T2025005" value={newTeacher.teacherId} onChange={e => setNewTeacher({ ...newTeacher, teacherId: e.target.value })} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">姓名</label>
                  <input type="text" required placeholder="教师姓名" value={newTeacher.name} onChange={e => setNewTeacher({ ...newTeacher, name: e.target.value })} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">初始密码</label>
                <input
                  type="text"
                  placeholder="不填则使用系统默认密码"
                  value={newTeacher.password}
                  onChange={e => setNewTeacher({ ...newTeacher, password: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">年级</label>
                  <input type="text" value={newTeacher.grade} onChange={e => setNewTeacher({ ...newTeacher, grade: e.target.value })} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">职称</label>
                  <input type="text" value={newTeacher.title} onChange={e => setNewTeacher({ ...newTeacher, title: e.target.value })} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs" />
                </div>
              </div>
              {/* College → Class cascade */}
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">所属学院（从数据库读取）</label>
                <select value={newTeacher.collegeId} onChange={e => { const c = collegesWithClasses.find(x => String(x.id) === e.target.value); setNewTeacher({ ...newTeacher, collegeId: e.target.value, college: c ? c.name : '', classes: '' }); }} className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border rounded-xl text-xs" onClick={() => { if (collegesWithClasses.length === 0) loadCollegesData(); }}>
                  <option value="">请选择学院</option>
                  {collegesWithClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">负责班级（从数据库勾选，可多选）</label>
                <div className="max-h-32 overflow-y-auto bg-slate-50 dark:bg-slate-800 border rounded-xl p-2 text-xs space-y-0.5">
                  {getClassesForCollege(newTeacher.collegeId).length === 0 ? (
                    <p className="text-slate-400 px-2 py-3 text-center">{newTeacher.collegeId ? '该学院暂无班级数据' : '请先选择学院'}</p>
                  ) : (
                    getClassesForCollege(newTeacher.collegeId).map(cls => {
                      const checked = newTeacher.classes.split(', ').includes(cls);
                      return <label key={cls} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer">
                        <input type="checkbox" checked={checked} onChange={() => {
                          const current = newTeacher.classes ? newTeacher.classes.split(', ').filter(Boolean) : [];
                          const updated = checked ? current.filter(x => x !== cls) : [...current, cls];
                          setNewTeacher({ ...newTeacher, classes: updated.join(', ') });
                        }} className="rounded" />
                        {cls}
                      </label>;
                    })
                  )}
                </div>
              </div>

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddTeacher(false)}
                  className="w-full sm:w-auto px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs rounded-xl"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl"
                >
                  保存添加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Teacher Grade Modal */}
      {showEditTeacherGrade && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto" onClick={() => setShowEditTeacherGrade(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md p-4 sm:p-6 shadow-2xl space-y-4 my-2 sm:my-8" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{isSuperAdmin ? '编辑管理年级' : '提交年级变更申请'} - {editTeacherName}</h3>
            {!isSuperAdmin && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2">
                辅导员修改管理年级需要提交申请，管理员审核通过后才会生效。
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">管理年级</label>
              <input
                type="text"
                value={editTeacherGrade}
                onChange={e => setEditTeacherGrade(e.target.value)}
                placeholder="如：2024级"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3">
              <button onClick={() => setShowEditTeacherGrade(false)} className="w-full sm:w-auto px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs rounded-xl">取消</button>
              <button onClick={saveTeacherGrade} className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl">
                {isSuperAdmin ? '保存年级' : '提交申请'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Teacher Classes Modal */}
      {showEditTeacherClasses && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/60 backdrop-blur-sm overflow-y-auto" onClick={() => setShowEditTeacherClasses(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6 shadow-2xl space-y-4 my-2 sm:my-8" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{isSuperAdmin ? '编辑负责班级' : '提交班级变更申请'} - {editTeacherName}</h3>
            {!isSuperAdmin && (
              <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-xl px-3 py-2">
                辅导员修改负责班级需要提交申请，管理员审核通过后才会生效。
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">选择班级（从数据库勾选，可多选）</label>
              <div className="max-h-60 overflow-y-auto bg-slate-50 dark:bg-slate-800 border rounded-xl p-3 text-xs space-y-1">
                {collegesWithClasses.length === 0 ? (
                  <p className="text-slate-400 text-center py-4">加载中或暂无班级数据</p>
                ) : (
                  collegesWithClasses.map(col => (
                    <div key={col.id}>
                      <p className="font-semibold text-slate-500 text-[11px] px-1 py-1">{col.name}</p>
                      {col.classes.map(cls => {
                        const checked = parseClassNames(editTeacherClasses).includes(cls);
                        return <label key={cls} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded cursor-pointer">
                          <input type="checkbox" checked={checked} onChange={() => {
                            const current = parseClassNames(editTeacherClasses);
                            const updated = checked ? current.filter(x => x !== cls) : [...current, cls];
                            setEditTeacherClasses(updated.join(', '));
                          }} className="rounded" />
                          {cls}
                        </label>;
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-3">
              <button onClick={() => setShowEditTeacherClasses(false)} className="w-full sm:w-auto px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs rounded-xl">取消</button>
              <button onClick={saveTeacherClasses} className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white text-xs font-semibold rounded-xl">
                {isSuperAdmin ? '保存班级' : '提交申请'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
