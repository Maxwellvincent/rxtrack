// calibration.js — pure calibration logic for the confidence turn loop.
// A record = { concept, confidence (1-5), correct (bool) }.
// "Confident" = confidence >= 4. A confident-wrong answer is a "landmine".

export const CONFIDENT_THRESHOLD = 4;

/**
 * Deep Learn asks for a predicted percentage (50 / 70 / 90); everything else rates 1–5.
 * One scale has to win, and 1–5 is the one the curve, the landmine list and the stored records
 * are all built on.
 *
 * The mapping is chosen to preserve the only boundary that carries meaning — CONFIDENT_THRESHOLD.
 * Saying "90% sure" and being wrong is a landmine; saying "70%" and being wrong is not, because
 * you already flagged the doubt. So 90 is the only bucket that lands at or above 4.
 */
export function confidenceFromPercent(predicted) {
  if (predicted >= 90) return 5;
  if (predicted >= 70) return 3;
  return 2;
}

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

/**
 * Every atom this session left needs-review, landmines first — the broader, atom-aware sibling of
 * `landmines` above. `landmines` stays as-is (CalibrationSession.jsx's own summary reads it and
 * its records don't all carry an atomKey); this is specifically for a quiz whose questions were
 * generated one-per-atom, where "what to go re-study" can point at something real.
 *
 * Deduped by atomKey, keeping each atom's LAST attempt this session — if you missed it then got
 * it right on a retry within the same session, it does not belong on a review list.
 */
export function atomsToReview(records = []) {
  const lastByAtom = new Map();
  for (const r of records) {
    if (!r?.atomKey) continue;
    lastByAtom.set(r.atomKey, r);
  }
  return [...lastByAtom.values()]
    .filter((r) => !r.correct)
    .sort((a, b) => (isLandmine(b) ? 1 : 0) - (isLandmine(a) ? 1 : 0));
}
