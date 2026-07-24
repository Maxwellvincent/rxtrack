// calibration.js — pure calibration logic for the confidence turn loop.
// A record = { concept, confidence (1-5), correct (bool) }.
// "Confident" = confidence >= 4. A confident-wrong answer is a "landmine".

export const CONFIDENT_THRESHOLD = 4;

export function classify({ confidence, correct }) {
  const confident = confidence >= CONFIDENT_THRESHOLD;
  if (confident) return correct ? "confident-right" : "confident-wrong";
  return correct ? "unsure-right" : "unsure-wrong";
}

export function isLandmine({ confidence, correct }) {
  return confidence >= CONFIDENT_THRESHOLD && !correct;
}

const QUADRANTS = ["confident-right", "confident-wrong", "unsure-right", "unsure-wrong"];

// Roll up a list of {concept, confidence, correct} records into the session readout:
//   curve     — accuracy per confidence level 1..5 (accuracy null when no items at that level)
//   landmines — confident-wrong records (concepts to review first), in encounter order
//   quadrants — tally per classify() bucket
export function summarize(records = []) {
  const curve = [1, 2, 3, 4, 5].map((level) => {
    const at = records.filter((r) => r.confidence === level);
    const correctCount = at.filter((r) => r.correct).length;
    return {
      level,
      count: at.length,
      correctCount,
      accuracy: at.length ? correctCount / at.length : null,
    };
  });

  const landmines = records
    .filter(isLandmine)
    .map((r) => ({ concept: r.concept, confidence: r.confidence }));

  const quadrants = Object.fromEntries(QUADRANTS.map((q) => [q, 0]));
  for (const r of records) quadrants[classify(r)] += 1;

  return { curve, landmines, quadrants };
}
