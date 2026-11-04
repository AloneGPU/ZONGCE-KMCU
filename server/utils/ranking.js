/**
 * Assign dense ranks after sorting by score: 90, 90, 85 => 1, 1, 2.
 * Scores are compared without rounding so raw calculated values are preserved.
 */
function normalizedScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? score : 0;
}

function compareByScoreDesc(scoreKey, tieBreaker) {
  return (left, right) => {
    const scoreDiff = normalizedScore(right[scoreKey]) - normalizedScore(left[scoreKey]);
    if (scoreDiff !== 0) return scoreDiff;

    if (!tieBreaker) return 0;
    return String(tieBreaker(left)).localeCompare(String(tieBreaker(right)), 'zh-Hans-CN', {
      numeric: true,
      sensitivity: 'base',
    });
  };
}

function assignDenseRanks(rows, scoreKey, rankKey = 'rank', tieBreaker) {
  const sortedRows = [...rows].sort(compareByScoreDesc(scoreKey, tieBreaker));
  let previousScore = null;
  let currentRank = 0;

  sortedRows.forEach(row => {
    const score = normalizedScore(row[scoreKey]);
    if (previousScore === null || score !== previousScore) {
      currentRank += 1;
      previousScore = score;
    }
    row[rankKey] = currentRank;
  });

  return sortedRows;
}

function assignRankingScope(rows, totalScoreKey = 'totalScore') {
  const sortedRows = assignDenseRanks(rows, totalScoreKey, 'rank', row => row.studentCode || row.student_id);
  const moduleIds = new Set(
    rows.flatMap(row => Array.isArray(row.modules) ? row.modules.map(module => Number(module.moduleId)) : [])
  );

  for (const moduleId of moduleIds) {
    const entries = rows.map(row => {
      const module = Array.isArray(row.modules)
        ? row.modules.find(item => Number(item.moduleId) === moduleId)
        : null;
      return {
        studentCode: row.studentCode || row.student_id,
        module,
        moduleScore: module ? Number(module.finalScore) || 0 : 0,
      };
    });
    assignDenseRanks(entries, 'moduleScore', 'rank', entry => entry.studentCode);
    entries.forEach(entry => {
      if (entry.module) entry.module.rank = entry.rank;
    });
  }

  return sortedRows;
}

function assignRankingGroups(rows, scopeKey, totalScoreKey = 'totalScore') {
  const groups = new Map();
  rows.forEach(row => {
    const key = String(scopeKey(row));
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  });

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right, 'zh-Hans-CN', { numeric: true }))
    .flatMap(([, group]) => assignRankingScope(group, totalScoreKey));
}

module.exports = {
  assignDenseRanks,
  assignRankingGroups,
  assignRankingScope,
  compareByScoreDesc,
  normalizedScore,
};
