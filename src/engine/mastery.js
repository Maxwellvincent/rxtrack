/** Mastery model — matches App.jsx (>=4 mastered, >=2 developing, else struggling). */
export function levelFromConsecutive(n) {
  const c = Number(n) || 0;
  return c >= 4 ? "mastered" : c >= 2 ? "developing" : "struggling";
}

export function modeForLevel(level) {
  if (level === "mastered") return "test";
  if (level === "developing") return "recognize";
  return "teach";
}

/** Pure: apply an outcome to a concept, returning a new concept object. */
export function recordOutcome(concept, outcome) {
  const c = concept || {};
  let consecutiveCorrect = c.consecutiveCorrect || 0;
  let missCount = c.missCount || 0;
  if (outcome === "correct") consecutiveCorrect += 1;
  else if (outcome === "wrong") { consecutiveCorrect = 0; missCount += 1; }
  // "exposure": leave streak untouched
  return {
    ...c,
    consecutiveCorrect,
    missCount,
    totalAttempts: (c.totalAttempts || 0) + 1,
    masteryLevel: levelFromConsecutive(consecutiveCorrect),
  };
}
