const assert = require('assert');
const { assignDenseRanks, assignRankingGroups, assignRankingScope } = require('./ranking');

function student(studentCode, totalScore, moduleScores) {
  return {
    studentCode,
    totalScore,
    modules: moduleScores.map((finalScore, index) => ({ moduleId: index + 1, finalScore })),
  };
}

function testDenseRanks() {
  const rows = [90, 90, 85, 80, 80, 70].map((score, index) => ({ score, studentCode: String(index + 1) }));
  const ranked = assignDenseRanks(rows, 'score', 'rank', row => row.studentCode);
  assert.deepStrictEqual(ranked.map(row => row.rank), [1, 1, 2, 3, 3, 4]);
}

function testTotalAndModuleRanks() {
  const rows = [
    student('001', 90, [80, 70]),
    student('002', 90, [80, 60]),
    student('003', 85, [70, 70]),
  ];
  const ranked = assignRankingScope(rows);
  assert.deepStrictEqual(ranked.map(row => row.rank), [1, 1, 2]);
  assert.deepStrictEqual(rows.map(row => row.modules[0].rank), [1, 1, 2]);
  assert.deepStrictEqual(rows.map(row => row.modules[1].rank), [1, 2, 1]);
}

function testClassScopesStayIndependent() {
  const rows = [
    { ...student('A1', 90, [80]), grade: '2024级', className: '软件工程1班' },
    { ...student('A2', 80, [70]), grade: '2024级', className: '软件工程1班' },
    { ...student('B1', 100, [99]), grade: '2025级', className: '软件工程1班' },
    { ...student('B2', 90, [80]), grade: '2025级', className: '软件工程1班' },
  ];
  assignRankingGroups(rows, row => `${row.grade}::${row.className}`);
  assert.deepStrictEqual(rows.map(row => row.rank), [1, 2, 1, 2]);
  assert.deepStrictEqual(rows.map(row => row.modules[0].rank), [1, 2, 1, 2]);
}

function testGradeRankDoesNotOverwriteClassRank() {
  const rows = [
    { studentCode: '001', totalScore: 90, rank: 2 },
    { studentCode: '002', totalScore: 90, rank: 1 },
    { studentCode: '003', totalScore: 80, rank: 1 },
  ];
  assignDenseRanks(rows, 'totalScore', 'gradeRank', row => row.studentCode);
  assert.deepStrictEqual(rows.map(row => row.gradeRank), [1, 1, 2]);
  assert.deepStrictEqual(rows.map(row => row.rank), [2, 1, 1]);
}

testDenseRanks();
testTotalAndModuleRanks();
testClassScopesStayIndependent();
testGradeRankDoesNotOverwriteClassRank();
console.log('ranking regression tests passed');
