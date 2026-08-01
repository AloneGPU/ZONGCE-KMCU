import {
  StudentRecord,
  BaseScores,
  ProofMaterial,
  RuleCategoryConfig,
  StudentScoreSummary
} from '../types';

export function calculateStudentSummaries(
  students: StudentRecord[],
  baseScoresList: BaseScores[],
  proofMaterials: ProofMaterial[],
  ruleConfigs: RuleCategoryConfig[],
  academicYear: string
): StudentScoreSummary[] {
  // Filter proof materials for the given academic year and only approved status
  const approvedMaterials = proofMaterials.filter(
    m => m.academicYear === academicYear && m.status === 'approved'
  );

  // Group bonus points by student and category
  const bonusMap = new Map<
    string,
    {
      moral: number;
      intellectual: number;
      physical: number;
      ability: number;
      aesthetics: number;
      labor: number;
      extra: number;
    }
  >();

  for (const mat of approvedMaterials) {
    if (!bonusMap.has(mat.studentId)) {
      bonusMap.set(mat.studentId, {
        moral: 0,
        intellectual: 0,
        physical: 0,
        ability: 0,
        aesthetics: 0,
        labor: 0,
        extra: 0
      });
    }

    const current = bonusMap.get(mat.studentId)!;
    const score = mat.approvedScore ?? mat.requestedScore ?? 0;

    switch (mat.categoryId) {
      case 'moral':
        current.moral += score;
        break;
      case 'intellectual':
        current.intellectual += score;
        break;
      case 'physical':
        current.physical += score;
        break;
      case 'ability':
        current.ability += score;
        break;
      case 'aesthetics':
        current.aesthetics += score;
        break;
      case 'labor':
        current.labor += score;
        break;
      case 'extra':
        current.extra += score;
        break;
    }
  }

  // Cap bonuses based on category maxBonusCap (if maxBonusCap > 0)
  const caps: Record<string, number> = {};
  for (const cfg of ruleConfigs) {
    caps[cfg.category] = cfg.maxBonusCap > 0 ? cfg.maxBonusCap : 999;
  }

  // Calculate preliminary scores for each student
  const rawSummaries: StudentScoreSummary[] = students.map(student => {
    const base = baseScoresList.find(
      b => b.studentId === student.studentId && b.academicYear === academicYear
    ) || {
      studentId: student.studentId,
      academicYear,
      moralBase: 60,
      moralDeduction: 0,
      intellectualBase: 85,
      physicalBase: 50,
      abilityBase: 60,
      aestheticsBase: 60,
      laborBase: 60
    };

    const studentBonus = bonusMap.get(student.studentId) || {
      moral: 0,
      intellectual: 0,
      physical: 0,
      ability: 0,
      aesthetics: 0,
      labor: 0,
      extra: 0
    };

    // Apply category caps
    const moralBonus = Math.min(studentBonus.moral, caps['moral'] ?? 40);
    const intellectualBonus = Math.min(studentBonus.intellectual, caps['intellectual'] ?? 999);
    const physicalBonus = Math.min(studentBonus.physical, caps['physical'] ?? 40);
    const abilityBonus = Math.min(studentBonus.ability, caps['ability'] ?? 40);
    const aestheticsBonus = Math.min(studentBonus.aesthetics, caps['aesthetics'] ?? 40);
    const laborBonus = Math.min(studentBonus.labor, caps['labor'] ?? 40);
    const extraBonus = Math.min(studentBonus.extra, caps['extra'] ?? 10);

    const moralDeduction = base.moralDeduction ?? 0;

    // Module Final Scores (0-100 scale according to Document formula):
    // 德育 = Math.max(0, Math.min(100, 60 + 德育加分 - 德育扣分))
    const moralFinal = Math.max(0, Math.min(100, base.moralBase + moralBonus - moralDeduction));

    // 智育素质分 = 学业成绩 (GPA)
    const intellectualFinal = Math.max(0, Math.min(100, base.intellectualBase + intellectualBonus));

    // 体育 = 体育基础分 + 体育竞赛加分
    const physicalFinal = Math.max(0, Math.min(100, base.physicalBase + physicalBonus));

    // 能力素质分 = 60 + 能力加分
    const abilityFinal = Math.max(0, Math.min(100, (base.abilityBase || 60) + abilityBonus));

    // 美育素质分 = 60 + 美育加分
    const aestheticsFinal = Math.max(0, Math.min(100, (base.aestheticsBase || 60) + aestheticsBonus));

    // 劳动素质分 = 60 + 劳动加分
    const laborFinal = Math.max(0, Math.min(100, (base.laborBase || 60) + laborBonus));

    // Formula weights from config (default: Moral 20%, Intellectual 40%, Physical 10%, Ability 10%, Aesthetics 10%, Labor 10%)
    const moralWeight = ruleConfigs.find(r => r.category === 'moral')?.baseWeight ?? 0.20;
    const intellectualWeight = ruleConfigs.find(r => r.category === 'intellectual')?.baseWeight ?? 0.40;
    const physicalWeight = ruleConfigs.find(r => r.category === 'physical')?.baseWeight ?? 0.10;
    const abilityWeight = ruleConfigs.find(r => r.category === 'ability')?.baseWeight ?? 0.10;
    const aestheticsWeight = ruleConfigs.find(r => r.category === 'aesthetics')?.baseWeight ?? 0.10;
    const laborWeight = ruleConfigs.find(r => r.category === 'labor')?.baseWeight ?? 0.10;

    const weightedScore =
      moralFinal * moralWeight +
      intellectualFinal * intellectualWeight +
      physicalFinal * physicalWeight +
      abilityFinal * abilityWeight +
      aestheticsFinal * aestheticsWeight +
      laborFinal * laborWeight +
      extraBonus;

    const totalScore = Number(weightedScore.toFixed(2));

    // Evaluation Grade
    let evaluationGrade: '优秀' | '良好' | '中等' | '合格' | '不合格' = '合格';
    if (totalScore >= 90) evaluationGrade = '优秀';
    else if (totalScore >= 80) evaluationGrade = '良好';
    else if (totalScore >= 70) evaluationGrade = '中等';
    else if (totalScore >= 60) evaluationGrade = '合格';
    else evaluationGrade = '不合格';

    // Disqualification flag (德育或智育低于60分取消评奖资格)
    const isDisqualified = moralFinal < 60 || intellectualFinal < 60;

    return {
      studentId: student.studentId,
      studentName: student.name,
      grade: student.grade,
      majorClass: student.majorClass,
      college: student.college,
      academicYear,

      moralBase: base.moralBase,
      moralDeduction,
      intellectualBase: base.intellectualBase,
      physicalBase: base.physicalBase,
      abilityBase: base.abilityBase || 60,
      aestheticsBase: base.aestheticsBase || 60,
      laborBase: base.laborBase || 60,

      moralBonus,
      intellectualBonus,
      physicalBonus,
      abilityBonus,
      aestheticsBonus,
      laborBonus,
      extraBonus,

      moralFinal,
      intellectualFinal,
      physicalFinal,
      abilityFinal,
      aestheticsFinal,
      laborFinal,

      evaluationGrade,
      isDisqualified,

      totalScore,
      classRank: 0,
      classTotal: 0,
      gradeRank: 0,
      gradeTotal: 0
    };
  });

  // Calculate Class Ranks & Grade Ranks
  const gradeGroups = new Map<string, StudentScoreSummary[]>();
  const classGroups = new Map<string, StudentScoreSummary[]>();

  for (const s of rawSummaries) {
    if (!gradeGroups.has(s.grade)) gradeGroups.set(s.grade, []);
    gradeGroups.get(s.grade)!.push(s);

    if (!classGroups.has(s.majorClass)) classGroups.set(s.majorClass, []);
    classGroups.get(s.majorClass)!.push(s);
  }

  // Sort and assign ranks
  gradeGroups.forEach(group => {
    group.sort((a, b) => b.totalScore - a.totalScore);
    const total = group.length;
    group.forEach((s, idx) => {
      s.gradeRank = idx + 1;
      s.gradeTotal = total;
    });
  });

  classGroups.forEach(group => {
    group.sort((a, b) => b.totalScore - a.totalScore);
    const total = group.length;
    group.forEach((s, idx) => {
      s.classRank = idx + 1;
      s.classTotal = total;
    });
  });

  return rawSummaries;
}
