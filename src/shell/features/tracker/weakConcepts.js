/**
 * SP1 T4.4 — the weak-concept list, as data.
 *
 * `rxt-weak-concepts` holds 759 records keyed by block, plus a `lifetime`
 * bucket that spans everything. They are the raw material for SP2's learner
 * model, and nothing in the shell surfaced them until now.
 *
 * Record shape (from the live store): concept, description, missCount,
 * totalAttempts, consecutiveCorrect, masteryLevel (mastered | developing |
 * struggling), lastMissed, lastCorrect, lectureLabels, linkedLecIds, blockId,
 * fromObjective, linkedObjId, tags.
 */

export const MASTERY_ORDER = { struggling: 0, developing: 1, mastered: 2 };

/** Flatten the store, tagging each record with the bucket it came from. */
export function flattenWeakConcepts(store, { blockId = null, includeLifetime = true } = {}) {
  const source = store && typeof store === "object" ? store : {};
  const out = [];
  for (const [bucket, list] of Object.entries(source)) {
    if (bucket === "_summary") continue; // compaction artefact, not a bucket
    if (bucket === "lifetime" && !includeLifetime) continue;
    if (blockId && bucket !== "lifetime" && bucket !== blockId) continue;
    for (const concept of Array.isArray(list) ? list : []) {
      if (concept && (concept.concept || concept.description)) out.push({ ...concept, bucket });
    }
  }
  return out;
}

/**
 * The same concept is often recorded in both its block and `lifetime`.
 * Keep one row per concept, preferring the record with the most evidence.
 */
export function dedupeConcepts(concepts) {
  const byKey = new Map();
  for (const c of concepts || []) {
    const key = String(c.id || c.concept || c.description).trim().toLowerCase();
    const existing = byKey.get(key);
    if (!existing || (c.missCount || 0) > (existing.missCount || 0)) byKey.set(key, c);
  }
  return [...byKey.values()];
}

/** Missed repeatedly and never yet held down — what to study first. */
export function isLandmine(concept) {
  return (
    concept?.masteryLevel === "struggling" &&
    (concept?.missCount || 0) >= 2 &&
    !(concept?.consecutiveCorrect > 0)
  );
}

/** Worst first: struggling before developing, then by misses, then by attempts. */
export function rankConcepts(concepts) {
  return [...(concepts || [])].sort((a, b) => {
    const byMastery =
      (MASTERY_ORDER[a.masteryLevel] ?? 3) - (MASTERY_ORDER[b.masteryLevel] ?? 3);
    if (byMastery) return byMastery;
    const byMiss = (b.missCount || 0) - (a.missCount || 0);
    if (byMiss) return byMiss;
    return (b.totalAttempts || 0) - (a.totalAttempts || 0);
  });
}

/**
 * @returns {{concepts: object[], counts: object, landmines: object[]}}
 */
export function weakConceptView(store, { blockId = null, includeMastered = false, limit = null } = {}) {
  const all = dedupeConcepts(flattenWeakConcepts(store, { blockId }));
  const counts = all.reduce(
    (acc, c) => {
      const key = c.masteryLevel || "unknown";
      acc[key] = (acc[key] || 0) + 1;
      acc.total += 1;
      return acc;
    },
    { total: 0 }
  );

  const filtered = includeMastered ? all : all.filter((c) => c.masteryLevel !== "mastered");
  const ranked = rankConcepts(filtered);

  return {
    concepts: limit ? ranked.slice(0, limit) : ranked,
    counts: { ...counts, landmines: all.filter(isLandmine).length },
    landmines: rankConcepts(all.filter(isLandmine)),
  };
}
