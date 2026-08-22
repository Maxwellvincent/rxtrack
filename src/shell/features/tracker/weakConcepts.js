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

/**
 * Flatten the store, tagging each record with the bucket it came from.
 *
 * `lifetime` mirrors every block's concepts (recordWrongAnswer pushes into
 * both), which is the point when scope is "everything" — but a block-scoped
 * read used to include the WHOLE lifetime bucket unfiltered, so "this block"
 * silently showed every concept from every block ever studied. Lifetime
 * entries are now also checked against the concept's own `blockId`.
 */
export function flattenWeakConcepts(store, { blockId = null, includeLifetime = true } = {}) {
  const source = store && typeof store === "object" ? store : {};
  const out = [];
  for (const [bucket, list] of Object.entries(source)) {
    if (bucket === "_summary") continue; // compaction artefact, not a bucket
    const isLifetime = bucket === "lifetime";
    if (isLifetime && !includeLifetime) continue;
    if (blockId && !isLifetime && bucket !== blockId) continue;
    for (const concept of Array.isArray(list) ? list : []) {
      if (!concept || !(concept.concept || concept.description)) continue;
      if (blockId && isLifetime && concept.blockId !== blockId) continue;
      out.push({ ...concept, bucket });
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
 * Anatomy/discipline -> lecture -> topic. An Anki image-occlusion deck often
 * splits one concept into several near-identical notes (one per occluded
 * label), each with its own id and a slightly different AI-written
 * description — `dedupeConcepts` doesn't catch these since the ids differ.
 * Grouping by (angle, lecture, topic NAME) collapses them into one row with
 * an item count and a summed miss count, instead of repeating the same
 * concept N times.
 */
export function groupWeakConcepts(concepts) {
  const byAngle = new Map();
  for (const c of concepts || []) {
    const angle = (c?.angle || "general").toLowerCase();
    const lectureLabel = c?.lectureLabels?.[0] || "Unlinked";
    const topicName = (c?.concept || c?.description || "Unnamed").trim();

    if (!byAngle.has(angle)) byAngle.set(angle, { angle, lectures: new Map() });
    const angleGroup = byAngle.get(angle);

    if (!angleGroup.lectures.has(lectureLabel)) angleGroup.lectures.set(lectureLabel, { lectureLabel, topics: new Map() });
    const lectureGroup = angleGroup.lectures.get(lectureLabel);

    const topicKey = topicName.toLowerCase();
    if (!lectureGroup.topics.has(topicKey)) {
      lectureGroup.topics.set(topicKey, { concept: topicName, items: [], missCount: 0, masteryLevel: "mastered" });
    }
    const topic = lectureGroup.topics.get(topicKey);
    topic.items.push(c);
    topic.missCount += c?.missCount || 0;
    if ((MASTERY_ORDER[c?.masteryLevel] ?? 3) < (MASTERY_ORDER[topic.masteryLevel] ?? 3)) {
      topic.masteryLevel = c.masteryLevel;
    }
  }

  return [...byAngle.values()].map((a) => ({
    angle: a.angle,
    lectures: [...a.lectures.values()].map((l) => ({
      lectureLabel: l.lectureLabel,
      topics: [...l.topics.values()],
    })),
  }));
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
