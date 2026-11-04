const SCORE_DECIMALS = 2;
const WEIGHT_DECIMALS = 2;
const WEIGHTED_SCORE_SCALE = 1_000_000;

function decimalToInteger(value, decimalPlaces) {
  const text = String(value ?? '0').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return 0;

  const negative = text.startsWith('-');
  const [wholeText, fractionText = ''] = (negative ? text.slice(1) : text).split('.');
  const whole = Number(wholeText);
  const fraction = Number((fractionText + '0'.repeat(decimalPlaces)).slice(0, decimalPlaces));
  const scale = 10 ** decimalPlaces;
  const result = whole * scale + fraction;
  return negative ? -result : result;
}

function scoreToCents(score) {
  return decimalToInteger(score, SCORE_DECIMALS);
}

function weightToBasisPoints(weight) {
  return decimalToInteger(weight, WEIGHT_DECIMALS);
}

function centsToScore(cents) {
  return cents / 100;
}

function calculateWeightedScoreScaled(rawScore, weight) {
  return scoreToCents(rawScore) * weightToBasisPoints(weight);
}

function weightedScaledToScore(weightedScaled) {
  return weightedScaled / WEIGHTED_SCORE_SCALE;
}

function calculateWeightedScore(rawScore, weight) {
  return weightedScaledToScore(calculateWeightedScoreScaled(rawScore, weight));
}

module.exports = {
  centsToScore,
  calculateWeightedScore,
  calculateWeightedScoreScaled,
  scoreToCents,
  weightToBasisPoints,
  weightedScaledToScore,
};
