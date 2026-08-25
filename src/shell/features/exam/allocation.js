// Cross-lecture question allocation policy — pure decision logic.
//
// Decides how many questions come from each eligible lecture given a total
// requested count, weighted by weak-concept severity and objective count,
// with a deterministic seeded PRNG so the same inputs always produce the
// same allocation (required for testability and for a later task's
// finalization correctness).

import { weakConceptsForLecture } from "../../logic/schedule.js";

// --- Deterministic PRNG (verbatim per task brief — do not substitute) ---

function hashStringToSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0, 1)
  };
}

/**
 * Returns a `() => number` PRNG in [0, 1) seeded deterministically from
 * `sessionId`. Exported (not just kept private) so tests can verify
 * determinism directly.
 */
export function makeSeededRandom(sessionId) {
  return mulberry32(hashStringToSeed(String(sessionId)));
}

// --- Weighted sampling helpers ---

// Picks an index from `pool` (array of { lectureId, weight }, already in
// fixed lexical order) using roulette-wheel selection against `totalWeight`.
// If totalWeight is 0 (all weights zero), falls back to uniform selection
// over the fixed order so a draw is still well-defined and deterministic.
function weightedPickIndex(pool, totalWeight, rand) {
  if (totalWeight <= 0) {
    let idx = Math.floor(rand() * pool.length);
    if (idx >= pool.length) idx = pool.length - 1;
    return idx;
  }
  const r = rand() * totalWeight;
  let cum = 0;
  for (let i = 0; i < pool.length; i++) {
    cum += pool[i].weight;
    if (r < cum) return i;
  }
  // Floating-point edge case: r landed exactly at/after the summed total.
  return pool.length - 1;
}

/**
 * Allocates `requestedCount` questions across `eligibleLectures` by
 * weak-concept severity and objective count, deterministically seeded by
 * `sessionId`. See task brief for the full algorithm.
 *
 * @returns {{ [lectureId: string]: number }}
 */
export function allocateQuestions({ eligibleLectures, requestedCount, weakConcepts, learnerEvidence, blockId, sessionId }) {
  if (!eligibleLectures || eligibleLectures.length === 0 || !requestedCount) {
    return {};
  }

  const maxEligibleObjectiveCount = eligibleLectures.reduce(
    (max, lec) => Math.max(max, lec.objectiveCount || 0),
    0
  );

  // Fixed iteration order: lectureId ascending, lexical. This is both the
  // tie-break rule and the order the roulette wheel's cumulative ranges are
  // built in, so ties are resolved deterministically and reproducibly.
  const ordered = [...eligibleLectures].sort((a, b) =>
    a.lectureId < b.lectureId ? -1 : a.lectureId > b.lectureId ? 1 : 0
  );

  const weighted = ordered.map((lec) => {
    const weakCount = weakConceptsForLecture(weakConcepts, blockId, lec.lectureId).length;
    const severity = Math.min(weakCount, 5) / 5;
    const objectiveCountNorm =
      maxEligibleObjectiveCount > 0 ? (lec.objectiveCount || 0) / maxEligibleObjectiveCount : 0;
    const evidence = learnerEvidence?.lectures?.[lec.lectureId];
    const evidenceDeficit = evidence?.attempts
      ? 1 - (evidence.correct || 0) / evidence.attempts
      : 0.65; // unseen lectures still receive purposeful exploration
    const weight = severity * 0.45 + objectiveCountNorm * 0.25 + evidenceDeficit * 0.3;
    return { lectureId: lec.lectureId, weight };
  });

  const rand = makeSeededRandom(sessionId);
  const counts = {};

  if (requestedCount < eligibleLectures.length) {
    // Below minimum coverage: weighted sampling WITHOUT replacement — pick
    // exactly `requestedCount` distinct lectures, each gets exactly 1.
    const pool = weighted.map((w) => ({ ...w }));
    let remaining = requestedCount;
    while (remaining > 0 && pool.length > 0) {
      const totalWeight = pool.reduce((sum, w) => sum + w.weight, 0);
      const idx = weightedPickIndex(pool, totalWeight, rand);
      const picked = pool[idx];
      counts[picked.lectureId] = (counts[picked.lectureId] || 0) + 1;
      pool.splice(idx, 1);
      remaining -= 1;
    }
    return counts;
  }

  // Minimum coverage: everyone gets 1 slot guaranteed.
  for (const lec of ordered) {
    counts[lec.lectureId] = 1;
  }

  let remaining = requestedCount - eligibleLectures.length;
  if (remaining > 0) {
    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    for (let i = 0; i < remaining; i++) {
      const idx = weightedPickIndex(weighted, totalWeight, rand);
      const picked = weighted[idx];
      counts[picked.lectureId] += 1;
    }
  }

  return counts;
}
