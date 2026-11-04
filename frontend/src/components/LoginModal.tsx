import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User } from '../types';
import {
  Lock,
  User as UserIcon,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  RefreshCw,
  Building2,
  Info,
  Eye,
  EyeOff,
  Mail,
  GraduationCap,
  UsersRound
} from 'lucide-react';
import { apiService } from '../services/api';
import { PrismBackground } from './visual/PrismBackground';

interface LoginModalProps {
  onLoginSuccess: (user: User) => void;
}

interface StepItem {
  id: number;
  label: string;
  detail: string;
}

interface RegisterClassOption {
  className: string;
  major: string;
  grade: string;
  collegeId: number | null;
  counselors: Array<{ id: number; name: string; grade: string }>;
}

interface RegisterCollegeOption {
  id: number;
  name: string;
  code: string;
}

interface RegisterCounselorOption {
  id: number;
  name: string;
  grade: string;
}

function inferRegistrationGrade(account: string) {
  const value = String(account || '').trim();
  if (/^20\d{2}/.test(value)) return `${value.slice(0, 4)}级`;
  if (/^\d{6,12}$/.test(value)) return `20${value.slice(0, 2)}级`;
  return '';
}

function registerClassKey(item: RegisterClassOption) {
  return `${item.grade}|${item.major}|${item.className}|${item.collegeId ?? ''}`;
}

const steps: StepItem[] = [
  { id: 0, label: '验证账号', detail: '正在核验账号、密码与访问权限。' },
  { id: 1, label: '读取基础数据', detail: '正在载入学生信息、班级信息与当前学年。' },
  { id: 2, label: '整理测评结果', detail: '正在读取材料状态、成绩记录与排名数据。' },
  { id: 3, label: '加载工作台', detail: '正在进入对应角色界面。' }
];

const REMEMBER_PASSWORD_KEY = 'zongce.rememberedLogin';

export const LoginModal: React.FC<LoginModalProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('');
  const [registrationRole, setRegistrationRole] = useState<'student' | 'counselor'>('student');
  const [registerCollegeId, setRegisterCollegeId] = useState('');
  const [registerMajor, setRegisterMajor] = useState('');
  const [registerClassName, setRegisterClassName] = useState('');
  const [registerClassKeys, setRegisterClassKeys] = useState<string[]>([]);
  const [registerCounselor, setRegisterCounselor] = useState('');
  const [registerOptions, setRegisterOptions] = useState<{ colleges: RegisterCollegeOption[]; majors: string[]; classes: RegisterClassOption[]; counselors: RegisterCounselorOption[] }>({
    colleges: [],
    majors: [],
    classes: [],
    counselors: []
  });
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('');
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);

  const [isLoading, setIsLoading] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [registerGrade, setRegisterGrade] = useState('');
  const registrationGrade = useMemo(() => registerGrade || inferRegistrationGrade(account), [account, registerGrade]);
  const availableGrades = useMemo(
    () => Array.from(new Set<string>(registerOptions.classes.map(item => String(item.grade || '')).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [registerOptions.classes]
  );
  const availableMajors = useMemo(
    () => Array.from(new Set<string>(registerOptions.classes
      .filter(item => !registrationGrade || item.grade === registrationGrade)
      .map(item => String(item.major || ''))
      .filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [registerOptions.classes, registrationGrade]
  );
  const filteredClasses = useMemo(() => registerOptions.classes.filter(item =>
    (!registerMajor || item.major === registerMajor) &&
    (!registrationGrade || item.grade === registrationGrade)
  ), [registrationGrade, registerMajor, registerOptions.classes]);
  const counselorRegisterClasses = useMemo(
    () => registerOptions.classes
      .filter(item => !registrationGrade || item.grade === registrationGrade)
      .sort((left, right) => left.major.localeCompare(right.major, 'zh-CN') || left.className.localeCompare(right.className, 'zh-CN')),
    [registerOptions.classes, registrationGrade]
  );
  const selectedCounselorClasses = useMemo(() => {
    const selected = new Set(registerClassKeys);
    return counselorRegisterClasses.filter(item => selected.has(registerClassKey(item)));
  }, [counselorRegisterClasses, registerClassKeys]);

  const registrationOptionsReady = registerOptions.majors.length > 0 && registerOptions.classes.length > 0;
  const selectedRegisterClass = useMemo(
    () => registerOptions.classes.find(item => item.className === registerClassName && item.grade === registrationGrade && item.major === registerMajor) || null,
    [registerClassName, registerMajor, registerOptions.classes, registrationGrade]
  );
  const availableCounselors = useMemo(() => {
    const classCounselors = selectedRegisterClass?.counselors || [];
    if (!registrationGrade) return classCounselors;
    return classCounselors.filter(item => !item.grade || item.grade === registrationGrade);
  }, [selectedRegisterClass, registrationGrade]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REMEMBER_PASSWORD_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      // 只恢复账号；密码一律不回填（历史版本曾明文存密码，遇到时顺手清理）
      if (data?.account) {
        setAccount(String(data.account));
        setRememberPassword(true);
        if (data?.password) {
          window.localStorage.setItem(REMEMBER_PASSWORD_KEY, JSON.stringify({ account: String(data.account) }));
        }
      }
    } catch {
      window.localStorage.removeItem(REMEMBER_PASSWORD_KEY);
    }
  }, []);

  useEffect(() => {
    apiService.fetchRegisterOptions()
      .then(data => {
        setRegisterOptions({
          colleges: data.colleges || [],
          majors: data.majors || [],
          classes: data.classes || [],
          counselors: data.counselors || []
        });
        const inferredGrade = inferRegistrationGrade(account);
        if (!registerGrade && (inferredGrade || data.classes?.[0]?.grade)) setRegisterGrade(inferredGrade || data.classes[0].grade);
        if (!registerMajor && data.majors?.[0]) setRegisterMajor(data.majors[0]);
        if (!registerCollegeId && data.classes?.[0]?.collegeId) setRegisterCollegeId(String(data.classes[0].collegeId));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (registrationRole !== 'student') return;
    if (!registrationOptionsReady) return;
    if (availableMajors.length === 0) {
      if (registerMajor) setRegisterMajor('');
      if (registerClassName) setRegisterClassName('');
      return;
    }
    if (!registerMajor || !availableMajors.includes(registerMajor)) {
      setRegisterMajor(availableMajors[0]);
      setRegisterClassName('');
      setRegisterCounselor('');
    }
  }, [availableMajors, registerClassName, registerMajor, registrationOptionsReady, registrationRole]);

  useEffect(() => {
    if (registrationRole !== 'student') return;
    if (!registerClassName && filteredClasses[0]) {
      setRegisterClassName(filteredClasses[0].className);
    } else if (registerClassName && filteredClasses.length > 0 && !filteredClasses.some(item => item.className === registerClassName)) {
      setRegisterClassName(filteredClasses[0].className);
    }
  }, [filteredClasses, registerClassName, registrationRole]);

  useEffect(() => {
    const inferred = inferRegistrationGrade(account);
    if (inferred && !registerGrade) setRegisterGrade(inferred);
  }, [account, registerGrade]);

  useEffect(() => {
    if (registrationRole !== 'counselor') return;
    const availableKeys = new Set(counselorRegisterClasses.map(registerClassKey));
    setRegisterClassKeys(prev => {
      const next = prev.filter(key => availableKeys.has(key));
      return next.length === prev.length ? prev : next;
    });
  }, [counselorRegisterClasses, registrationRole]);

  useEffect(() => {
    const collegeId = registrationRole === 'counselor'
      ? selectedCounselorClasses[0]?.collegeId
      : selectedRegisterClass?.collegeId;
    if (!collegeId) return;
    setRegisterCollegeId(String(collegeId));
  }, [registrationRole, selectedCounselorClasses, selectedRegisterClass]);

  useEffect(() => {
    if (availableCounselors.length === 1) {
      setRegisterCounselor(availableCounselors[0].name);
      return;
    }
    if (!availableCounselors.some(item => item.name === registerCounselor)) {
      setRegisterCounselor('');
    }
  }, [availableCounselors, registerCounselor]);

  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          return 100;
        }

        const ceiling = authReady ? 100 : 86;
        const step = authReady
          ? Math.floor(Math.random() * 12) + 12
          : Math.floor(Math.random() * 7) + 5;
        const next = Math.min(prev + step, ceiling);
        if (next < 28) setCurrentStep(0);
        else if (next < 58) setCurrentStep(1);
        else if (next < 88) setCurrentStep(2);
        else setCurrentStep(3);

        if (next >= 100 && authReady && pendingUser) {
          setTimeout(() => onLoginSuccess(pendingUser), 320);
        }
        return next;
      });
    }, 260);

    return () => clearInterval(interval);
  }, [isLoading, authReady, pendingUser, onLoginSuccess]);

  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => setCodeCooldown(prev => Math.max(0, prev - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  const beginLoading = () => {
    setIsLoading(true);
    setProgress(5);
    setCurrentStep(0);
    setPendingUser(null);
    setAuthReady(false);
  };

  const stopLoading = () => {
    setIsLoading(false);
    setProgress(0);
    setCurrentStep(0);
    setPendingUser(null);
    setAuthReady(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!account.trim() || !password.trim()) {
      setErrorMsg('请输入正确的账号与密码');
      return;
    }

    try {
      beginLoading();
      const matchedUser = await apiService.login(account.trim(), password);
      if (rememberPassword) {
        window.localStorage.setItem(REMEMBER_PASSWORD_KEY, JSON.stringify({
          account: account.trim()
        }));
      } else {
        window.localStorage.removeItem(REMEMBER_PASSWORD_KEY);
      }
      setPendingUser(matchedUser);
      setAuthReady(true);
    } catch (err: any) {
      stopLoading();
      setErrorMsg(err?.message || '登录失败，请检查账号密码');
    }
  };

  const handleSendRegisterCode = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!registerEmail.trim()) {
      setErrorMsg('请先填写邮箱号');
      return;
    }
    try {
      setIsSendingCode(true);
      await apiService.sendEmailCode({ email: registerEmail.trim(), purpose: 'register' });
      setCodeCooldown(60);
      setSuccessMsg('验证码已发送，请查看邮箱。');
    } catch (err: any) {
      setErrorMsg(err?.message || '验证码发送失败');
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleSendResetCode = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    if (!account.trim() || !resetEmail.trim()) {
      setErrorMsg('请先填写账号和邮箱号');
      return;
    }
    try {
      setIsSendingCode(true);
      await apiService.sendEmailCode({ account: account.trim(), email: resetEmail.trim(), purpose: 'reset_password' });
      setCodeCooldown(60);
      setSuccessMsg('验证码已发送，请查看邮箱。');
    } catch (err: any) {
      setErrorMsg(err?.message || '验证码发送失败');
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!registrationOptionsReady) {
      setErrorMsg('管理员尚未配置可注册的专业班级和辅导员，请联系管理员完成班级管理后再注册。');
      return;
    }

    if (!account.trim() || !registerName.trim() || !password || !registerPasswordConfirm || !registerEmail.trim()) {
      setErrorMsg('请完整填写注册信息');
      return;
    }
    if (!emailCode.trim()) {
      setErrorMsg('请输入邮箱验证码');
      return;
    }
    if (password !== registerPasswordConfirm) {
      setErrorMsg('两次输入的密码不一致');
      return;
    }
    if (registrationRole === 'student' && (!registrationGrade || !registerMajor || !registerClassName || !registerCounselor.trim())) {
      setErrorMsg('请选择年级、专业、班级和辅导员');
      return;
    }
    if (registrationRole === 'counselor' && (!registrationGrade || selectedCounselorClasses.length === 0)) {
      setErrorMsg('请选择管理年级和至少一个负责班级');
      return;
    }

    try {
      beginLoading();
      const classMeta = registerOptions.classes.find(item => item.className === registerClassName && item.major === registerMajor && item.grade === registrationGrade);
      const primaryClass = selectedCounselorClasses[0] || classMeta;
      const commonData = {
        account: account.trim(), name: registerName.trim(), password,
        email: registerEmail.trim(), emailCode: emailCode.trim(),
        major: primaryClass?.major || registerMajor,
        grade: registrationGrade,
        className: primaryClass?.className || registerClassName
      };
      const matchedUser = registrationRole === 'counselor'
        ? await apiService.registerCounselor({
            ...commonData,
            collegeId: primaryClass?.collegeId || (registerCollegeId ? Number(registerCollegeId) : null),
            classes: selectedCounselorClasses.map(item => ({
              grade: item.grade,
              major: item.major,
              className: item.className,
              collegeId: item.collegeId
            }))
          })
        : await apiService.registerStudent({ ...commonData, counselorName: registerCounselor.trim(), collegeId: classMeta?.collegeId || null });
      setPendingUser(matchedUser);
      setAuthReady(true);
    } catch (err: any) {
      stopLoading();
      setErrorMsg(err?.message || '注册失败，请核对信息后重试');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    if (!account.trim() || !resetEmail.trim() || !resetCode.trim() || !password || !resetPasswordConfirm) {
      setErrorMsg('请完整填写找回密码信息');
      return;
    }
    if (password !== resetPasswordConfirm) {
      setErrorMsg('两次输入的新密码不一致');
      return;
    }
    try {
      await apiService.resetPassword({
        account: account.trim(),
        email: resetEmail.trim(),
        code: resetCode.trim(),
        newPassword: password
      });
      setSuccessMsg('密码已重置，请使用新密码登录。');
      setMode('login');
      setPassword('');
      setResetPasswordConfirm('');
      setResetCode('');
    } catch (err: any) {
      setErrorMsg(err?.message || '密码重置失败');
    }
  };

  const switchMode = (nextMode: 'login' | 'register' | 'reset') => {
    setMode(nextMode);
    setErrorMsg('');
    setSuccessMsg('');
    setShowPassword(false);
    if (nextMode !== 'login') {
      setPassword('');
      return;
    }
    try {
      const saved = window.localStorage.getItem(REMEMBER_PASSWORD_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      // 只恢复账号；密码一律不回填（历史版本曾明文存密码，遇到时顺手清理）
      if (data?.account) {
        setAccount(String(data.account));
        setRememberPassword(true);
        if (data?.password) {
          window.localStorage.setItem(REMEMBER_PASSWORD_KEY, JSON.stringify({ account: String(data.account) }));
        }
      }
    } catch {
      window.localStorage.removeItem(REMEMBER_PASSWORD_KEY);
    }
  };

  return (
    <div className="login-stage fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-0 sm:items-center sm:p-5">
      <div className="login-animated-bg">
        <PrismBackground intensity={1.72} speed={0.2} hueShift={-0.46} />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -16 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="login-shell relative my-0 grid min-h-full max-h-none w-full max-w-5xl overflow-visible sm:my-auto sm:min-h-0 sm:max-h-[calc(100dvh-2.5rem)] sm:overflow-y-auto sm:overflow-x-hidden md:grid-cols-12"
      >
        <div className="login-visual-panel relative hidden min-h-[36rem] overflow-hidden p-8 text-white md:col-span-5 md:flex">
          <div className="login-visual-grid" />
          <div className="relative z-10 flex h-full flex-col justify-between gap-8">
            <div>
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-teal-300/35 bg-teal-400/12 shadow-inner">
                  <Building2 className="h-5 w-5 text-teal-200" />
                </div>
                <div>
                  <div className="text-sm font-bold tracking-tight">综合素质测评系统</div>
                  <div className="text-[11px] text-slate-400">Evaluation Console</div>
                </div>
              </div>
              <h1 className="max-w-xs text-2xl font-black leading-tight tracking-tight sm:text-3xl">
                进入你的综测工作台
              </h1>
              <p className="mt-3 max-w-xs text-xs leading-relaxed text-slate-300">
                学生申报、班委初审、辅导员终审与班级统计在同一处完成。
              </p>
            </div>

            <div className="login-flow-status text-[11px]">
              <span className="login-status-mark" />
              <span>学生申报、班委初审、辅导员终审实时协同</span>
            </div>
          </div>
        </div>

        <div className="login-form-panel min-w-0 p-4 sm:p-7 md:col-span-7 md:p-8">
          <div className="mb-5 flex items-center gap-3 md:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-teal-200 bg-teal-50 text-teal-700 shadow-sm dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-300">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-black tracking-tight text-slate-950 dark:text-white">综合素质测评系统</div>
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Evaluation Console</div>
            </div>
          </div>
          <AnimatePresence mode="wait">
            {!isLoading ? (
              <motion.div
                key="auth-form"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
                  {[
                    { key: 'login', label: '登录' },
                    { key: 'register', label: '注册' }
                  ].map(item => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => switchMode(item.key as 'login' | 'register')}
                      className={`h-9 flex-1 rounded-lg text-sm font-bold transition-all ${
                        mode === item.key
                          ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white'
                          : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div>
                  <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">
                    {mode === 'login' ? '账号登录' : registrationRole === 'counselor' ? '辅导员注册' : '学生注册'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {mode === 'login'
                      ? '使用学号、教师工号或管理员账号进入系统。'
                      : mode === 'register'
                        ? registrationRole === 'counselor' ? '使用工号、邮箱验证和负责班级完成自助建档。' : '第一次使用的同学请创建本地账号。'
                        : '通过绑定邮箱验证码重置本地密码。'}
                  </p>
                </div>

                <form onSubmit={mode === 'login' ? handleLogin : mode === 'register' ? handleRegister : handleResetPassword} className="space-y-3.5 sm:space-y-4">
                  {mode === 'register' && (
                    <div className="grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
                      {([
                        { key: 'student', label: '学生注册' },
                        { key: 'counselor', label: '辅导员注册' }
                      ] as const).map(item => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            setRegistrationRole(item.key);
                            setRegisterCounselor('');
                            setRegisterClassName('');
                            setRegisterClassKeys([]);
                          }}
                          className={`h-9 rounded-lg text-xs font-bold transition-all ${registrationRole === item.key ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={mode === 'register' ? 'grid gap-4 sm:grid-cols-2' : 'space-y-4'}>
                    <Field label={mode === 'register' ? registrationRole === 'counselor' ? '工号' : '学号' : '账号'} icon={<UserIcon className="h-4 w-4" />}>
                      <input
                        type="text"
                        value={account}
                        onChange={e => setAccount(e.target.value)}
                        placeholder={mode === 'register' ? registrationRole === 'counselor' ? '请输入辅导员工号' : '请输入学号' : '学号 / 工号 / 管理员账号'}
                        required
                        autoComplete="username"
                        className="auth-input"
                      />
                    </Field>

                    {mode === 'register' && (
                      <Field label="姓名" icon={<UserIcon className="h-4 w-4" />}>
                        <input
                          type="text"
                          value={registerName}
                          onChange={e => setRegisterName(e.target.value)}
                          placeholder="请输入真实姓名"
                          required
                          className="auth-input"
                        />
                      </Field>
                    )}
                  </div>

                  {mode === 'register' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="邮箱号" icon={<Mail className="h-4 w-4" />}>
                        <input
                          type="email"
                          value={registerEmail}
                          onChange={e => setRegisterEmail(e.target.value)}
                          placeholder="用于后续找回密码"
                          required
                          autoComplete="email"
                          className="auth-input"
                        />
                      </Field>
                      <Field label="邮箱验证码" icon={<Mail className="h-4 w-4" />}>
                        <input
                          type="text"
                          value={emailCode}
                          onChange={e => setEmailCode(e.target.value)}
                          placeholder="6 位验证码"
                          required
                          className="auth-input sm:pr-24"
                        />
                        <button
                          type="button"
                          onClick={handleSendRegisterCode}
                          disabled={isSendingCode || codeCooldown > 0}
                          className="relative mt-2 h-9 w-full rounded-lg bg-slate-900 px-2 text-[11px] font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50 sm:absolute sm:right-2 sm:top-2 sm:mt-0 sm:h-7 sm:w-auto dark:bg-slate-700 dark:hover:bg-teal-700"
                        >
                          {isSendingCode ? '发送中' : codeCooldown > 0 ? `${codeCooldown}s` : '发送'}
                        </button>
                      </Field>
                    </div>
                  )}

                  {mode === 'reset' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="绑定邮箱" icon={<Mail className="h-4 w-4" />}>
                        <input
                          type="email"
                          value={resetEmail}
                          onChange={e => setResetEmail(e.target.value)}
                          placeholder="未绑定邮箱的学生可填写新邮箱"
                          required
                          autoComplete="email"
                          className="auth-input"
                        />
                      </Field>
                      <Field label="邮箱验证码" icon={<Mail className="h-4 w-4" />}>
                        <input
                          type="text"
                          value={resetCode}
                          onChange={e => setResetCode(e.target.value)}
                          placeholder="6 位验证码"
                          required
                          className="auth-input sm:pr-24"
                        />
                        <button
                          type="button"
                          onClick={handleSendResetCode}
                          disabled={isSendingCode || codeCooldown > 0}
                          className="relative mt-2 h-9 w-full rounded-lg bg-slate-900 px-2 text-[11px] font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50 sm:absolute sm:right-2 sm:top-2 sm:mt-0 sm:h-7 sm:w-auto dark:bg-slate-700 dark:hover:bg-teal-700"
                        >
                          {isSendingCode ? '发送中' : codeCooldown > 0 ? `${codeCooldown}s` : '发送'}
                        </button>
                      </Field>
                    </div>
                  )}

                  <div className={mode === 'register' ? 'grid gap-4 sm:grid-cols-2' : ''}>
                    <Field label={mode === 'reset' ? '新密码' : '密码'} icon={<Lock className="h-4 w-4" />}>
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder={mode === 'login' ? '请输入密码' : '至少 6 位'}
                        required
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        className="auth-input pr-11"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-2.5 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                        tabIndex={-1}
                        aria-label={showPassword ? '隐藏密码' : '显示密码'}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </Field>

                    {mode === 'login' && (
                      <label className="mt-2 flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-teal-200 hover:bg-teal-50/60 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-teal-800 dark:hover:bg-teal-950/35">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={rememberPassword}
                            onChange={e => {
                              const checked = e.target.checked;
                              setRememberPassword(checked);
                              if (!checked) window.localStorage.removeItem(REMEMBER_PASSWORD_KEY);
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-700 dark:bg-slate-950"
                          />
                          记住账号
                        </span>
                        <span className="text-[11px] font-medium text-slate-400">下次自动填入</span>
                      </label>
                    )}

                    {mode !== 'login' && (
                      <Field label={mode === 'reset' ? '确认新密码' : '确认密码'} icon={<Lock className="h-4 w-4" />}>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={mode === 'register' ? registerPasswordConfirm : resetPasswordConfirm}
                          onChange={e => mode === 'register' ? setRegisterPasswordConfirm(e.target.value) : setResetPasswordConfirm(e.target.value)}
                          placeholder={mode === 'reset' ? '再次输入新密码' : '再次输入密码'}
                          required
                          autoComplete="new-password"
                          className="auth-input"
                        />
                      </Field>
                    )}
                  </div>

                  {mode === 'register' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {!registrationOptionsReady && (
                        <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                          暂无可注册的专业班级。请联系管理员在“师生数据与班级名单管理 - 班级管理”中完成配置。
                        </div>
                      )}
                      <Field label="年级" icon={<GraduationCap className="h-4 w-4" />}>
                        <select
                          value={registrationGrade}
                          onChange={e => { setRegisterGrade(e.target.value); setRegisterClassName(''); setRegisterClassKeys([]); setRegisterCounselor(''); }}
                          required
                          disabled={!registrationOptionsReady || availableGrades.length === 0}
                          className="auth-input appearance-none disabled:cursor-not-allowed disabled:opacity-65"
                        >
                          <option value="">请选择年级</option>
                          {availableGrades.map(grade => (
                            <option key={grade} value={grade}>{grade}</option>
                          ))}
                        </select>
                      </Field>

                      {registrationRole === 'student' ? (
                        <>
                          <Field label="专业" icon={<GraduationCap className="h-4 w-4" />}>
                            <select
                              value={registerMajor}
                              onChange={e => {
                                setRegisterMajor(e.target.value);
                                setRegisterClassName('');
                                setRegisterCounselor('');
                              }}
                              required
                              disabled={!registrationOptionsReady || availableMajors.length === 0}
                              className="auth-input appearance-none disabled:cursor-not-allowed disabled:opacity-65"
                            >
                              <option value="">{availableMajors.length === 0 ? '请先选择年级' : '请选择专业'}</option>
                              {availableMajors.map(major => (
                                <option key={major} value={major}>{major}</option>
                              ))}
                            </select>
                          </Field>

                          <Field label="班级" icon={<UsersRound className="h-4 w-4" />}>
                            <select
                              value={registerClassName}
                              onChange={e => {
                                setRegisterClassName(e.target.value);
                                setRegisterCounselor('');
                              }}
                              required
                              disabled={!registrationOptionsReady || filteredClasses.length === 0}
                              className="auth-input appearance-none disabled:cursor-not-allowed disabled:opacity-65"
                            >
                              <option value="">{filteredClasses.length === 0 ? '请先选择年级和专业' : '请选择班级'}</option>
                              {filteredClasses.map(item => (
                                <option key={`${item.grade}-${item.major}-${item.className}`} value={item.className}>{item.className}</option>
                              ))}
                            </select>
                          </Field>

                          <div className="sm:col-span-2">
                            <Field label="辅导员姓名" icon={<UserIcon className="h-4 w-4" />}>
                              <select
                                value={registerCounselor}
                                onChange={e => setRegisterCounselor(e.target.value)}
                                required
                                disabled={!registrationGrade || availableCounselors.length === 0}
                                className="auth-input appearance-none disabled:cursor-not-allowed disabled:opacity-65"
                              >
                                <option value="">
                                  {!registrationGrade
                                    ? '请先选择年级'
                                    : availableCounselors.length === 0
                                      ? `未配置${registrationGrade}对应辅导员`
                                      : '请选择辅导员'}
                                </option>
                                {availableCounselors.map(item => (
                                  <option key={item.id} value={item.name}>{item.name} · {item.grade}</option>
                                ))}
                              </select>
                            </Field>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="sm:col-span-2">
                            <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">负责班级（可多选）</label>
                            <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-800 dark:bg-slate-900/70">
                              {counselorRegisterClasses.length === 0 ? (
                                <div className="px-2 py-4 text-center text-slate-400">请先选择管理年级</div>
                              ) : (
                                <div className="grid gap-1 sm:grid-cols-2">
                                  {counselorRegisterClasses.map(item => {
                                    const key = registerClassKey(item);
                                    const checked = registerClassKeys.includes(key);
                                    return (
                                      <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            setRegisterClassKeys(prev => checked ? prev.filter(value => value !== key) : [...prev, key]);
                                          }}
                                          className="h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600 dark:border-slate-700 dark:bg-slate-950"
                                        />
                                        <span className="min-w-0 truncate">{item.major} · {item.className}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            <div className="mt-1.5 text-[11px] font-medium text-slate-400">
                              已选择 {selectedCounselorClasses.length} 个班级；同一班级已有辅导员时系统会阻止重复绑定。
                            </div>
                          </div>

                          <Field label="学院" icon={<Building2 className="h-4 w-4" />}>
                            <select value={registerCollegeId} onChange={e => setRegisterCollegeId(e.target.value)} required disabled className="auth-input appearance-none disabled:cursor-not-allowed disabled:opacity-65">
                              <option value="">{selectedCounselorClasses.length > 0 ? '未绑定学院' : '选择班级后自动带出'}</option>
                              {registerOptions.colleges.map(college => <option key={college.id} value={college.id}>{college.name}</option>)}
                            </select>
                          </Field>
                          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                            辅导员可一次选择同一年级下的多个负责班级；管理员端新增教师和教师导入模板也支持多班级。
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {successMsg && (
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span>{successMsg}</span>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                      <Info className="h-4 w-4 shrink-0" />
                      <span>{errorMsg}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={mode === 'register' && !registrationOptionsReady}
                    className="motion-lift group flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-bold !text-white shadow-lg shadow-teal-900/20 transition-all hover:bg-teal-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>{mode === 'login' ? '进入系统' : mode === 'register' ? '完成注册并进入系统' : '重置密码'}</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </button>

                  {mode === 'login' ? (
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      className="w-full text-center text-xs font-semibold text-slate-500 transition-colors hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
                    >
                      忘记密码？使用邮箱验证码找回
                    </button>
                  ) : mode === 'reset' ? (
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="w-full text-center text-xs font-semibold text-slate-500 transition-colors hover:text-teal-700 dark:text-slate-400 dark:hover:text-teal-300"
                    >
                      返回登录
                    </button>
                  ) : null}
                </form>
              </motion.div>
            ) : (
              <motion.div
                key="loading-progress"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="space-y-5 py-4"
              >
                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/80">
                  <div className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-teal-100/80 to-transparent blur-2xl dark:from-teal-900/35" />
                  <div className="relative flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-teal-200 bg-white shadow-sm dark:border-teal-800 dark:bg-slate-950">
                        <RefreshCw className="h-5 w-5 animate-spin text-teal-700 dark:text-teal-300" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">正在载入数据</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">读取账号信息、材料状态与综测结果。</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-2xl font-black text-teal-700 dark:text-teal-300">{progress}%</div>
                      <div className="text-[10px] font-semibold text-slate-400">{authReady ? '即将进入' : '处理中'}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-300">
                    <span>加载进度</span>
                    <span>{steps[currentStep]?.label}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full border border-slate-300/40 bg-slate-200 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-teal-700 via-emerald-500 to-amber-500 shadow-[0_0_18px_rgba(15,118,110,0.35)]"
                      initial={{ width: '0%' }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.2 }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400">
                  {['身份校验', '数据读取', '工作台'].map((label, idx) => (
                    <div
                      key={label}
                      className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                        currentStep >= idx + 1
                          ? 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300'
                          : 'border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {label}
                    </div>
                  ))}
                </div>

                <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700 dark:bg-slate-800/80">
                  {steps.map((st, idx) => {
                    const isDone = currentStep > idx || progress === 100;
                    const isCurrent = currentStep === idx && progress < 100;

                    return (
                      <div
                        key={st.id}
                        className={`flex items-start space-x-2.5 text-xs transition-opacity duration-200 ${
                          isDone
                            ? 'font-medium text-slate-900 dark:text-slate-100'
                            : isCurrent
                              ? 'font-semibold text-teal-700 dark:text-teal-300'
                              : 'text-slate-400 opacity-60 dark:text-slate-500'
                        }`}
                      >
                        <div className="mt-0.5 shrink-0">
                          {isDone ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : isCurrent ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-teal-700 border-t-transparent dark:border-teal-300" />
                          ) : (
                            <div className="h-4 w-4 rounded-full border border-slate-300 dark:border-slate-600" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span>{st.label}</span>
                            {isDone && <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400">OK</span>}
                          </div>
                          {isCurrent && (
                            <p className="mt-0.5 text-[11px] font-normal leading-tight text-slate-500 dark:text-slate-400">
                              {st.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-center gap-1 text-center text-[11px] text-slate-400">
                  <Sparkles className="h-3.5 w-3.5 text-teal-500" />
                  <span>综合素质测评数据工作台</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-300">{label}</label>
      <div className="relative">
        <div className="pointer-events-none absolute left-3 top-3.5 text-slate-400">{icon}</div>
        {children}
      </div>
    </div>
  );
}
