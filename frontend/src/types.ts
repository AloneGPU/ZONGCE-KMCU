export type UserRole = 'admin' | 'counselor' | 'assistant' | 'student';

export interface User {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  avatar?: string;
  college: string;
  grade?: string;
  majorClass?: string;
  studentId?: string; // 工号 or 学号
  studentDbId?: string;
  email?: string;
  title?: string;
}

export type SubmissionStatus = 'pending' | 'approved' | 'rejected' | 'draft';

export type CategoryType = 'moral' | 'intellectual' | 'physical' | 'ability' | 'aesthetics' | 'labor' | 'extra';

export interface BonusRuleItem {
  id: string;
  category: CategoryType;
  categoryName: string;
  name: string;
  description: string;
  maxScore: number;
  unitScore: number;
  requiresProof: boolean;
  evidence?: string;
  scoreType: 'fixed' | 'tiered' | 'input';
}

export interface RuleCategoryConfig {
  moduleId?: number;
  category: CategoryType;
  categoryName: string;
  baseWeight: number; // e.g. 0.20 for Moral, 0.40 for Intellectual, 0.10 for Physical, etc.
  maxBonusCap: number; // Max total bonus points allowed in this category
  items: BonusRuleItem[];
}

export interface ProofMaterial {
  id: string;
  studentId: string;
  studentName: string;
  majorClass: string;
  academicYear: string;
  categoryId: CategoryType;
  categoryName: string;
  ruleItemId: string;
  ruleItemName: string;
  title: string;
  description: string;
  awardMonth?: string;
  proofUrl?: string;
  requestedScore: number;
  approvedScore?: number;
  status: SubmissionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewerName?: string;
  reviewerRole?: 'counselor' | 'assistant';
  rejectReason?: string;
}

export interface BaseScores {
  studentId: string;
  academicYear: string;
  moralBase: number;       // 德育基础分 (默认60)
  moralDeduction?: number; // 违纪扣分
  intellectualBase: number; // 智育/GPA加权平均分 (0-100)
  physicalBase: number;     // 体育基础分 (课程+体测 0-60)
  abilityBase: number;      // 能力基础分 (默认60)
  aestheticsBase: number;   // 美育基础分 (默认60)
  laborBase: number;        // 劳动基础分 (默认60)
}

export interface StudentScoreSummary {
  studentId: string;
  studentName: string;
  grade: string;
  majorClass: string;
  college: string;
  academicYear: string;

  // Base scores
  moralBase: number;
  moralDeduction: number;
  intellectualBase: number;
  physicalBase: number;
  abilityBase: number;
  aestheticsBase: number;
  laborBase: number;

  // Bonus scores (from approved materials)
  moralBonus: number;
  intellectualBonus: number;
  physicalBonus: number;
  abilityBonus: number;
  aestheticsBonus: number;
  laborBonus: number;
  extraBonus: number;
  innovationBonus?: number;
  volunteerBonus?: number;

  // Final Module Scores (0-100)
  moralFinal: number;
  intellectualFinal: number;
  physicalFinal: number;
  abilityFinal: number;
  aestheticsFinal: number;
  laborFinal: number;

  // Evaluation Grade & Cancel Eligibility
  evaluationGrade: '优秀' | '良好' | '中等' | '合格' | '不合格';
  isDisqualified: boolean; // 德育或智育低于60分取消评奖资格

  // Comprehensive Score
  totalScore: number;

  // Rankings
  classRank: number;
  classTotal: number;
  gradeRank: number;
  gradeTotal: number;
}

export interface AcademicYearConfig {
  year: string; // e.g. "2025-2026", "2026-2027"
  isCurrent: boolean;
  isLocked: boolean; // Locked for submissions/edits
  deadline?: string;
}

export interface SystemSettings {
  rulesLocked: boolean; // Admin locked rule modifications
  activeAcademicYear: string;
  allowedYears: string[];
}

export interface TeacherRecord {
  id: string;
  teacherId: string; // 工号
  name: string;
  email?: string;
  college: string;
  grade: string;
  title: string;
  classes?: string[];
}

export interface StudentRecord {
  id: string;
  studentId: string; // 学号
  name: string;
  grade: string;
  majorClass: string;
  college: string;
  gender?: string;
  phone?: string;
}
