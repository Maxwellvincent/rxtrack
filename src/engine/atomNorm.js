/**
 * Cross-lecture atom identity and recurrence utilities.
 *
 * An atom's canonical identity is its normalized term — `type` and `content`
 * vary slightly between re-extractions of the same concept, but the term is
 * stable enough to use as a cross-lecture key.
 */

/** Lowercase, collapse whitespace, strip non-alphanumeric except hyphens. */
export function normAtomKey(term) {
  return (term || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merge a lecture's extracted atoms into the cross-lecture term index.
 *
 * Index shape: { [normKey]: { term, type, count, lectureIds: string[] } }
 *
 * @param {object} index   existing index (may be null/empty)
 * @param {string} lectureId
 * @param {Array}  atoms   atoms for that lecture: [{ term, type, content }]
 * @returns {object} next index (new object, original unchanged)
 */
export function mergeAtomsIntoIndex(index, lectureId, atoms) {
  const next = { ...(index || {}) };
  for (const atom of (atoms || [])) {
    const key = normAtomKey(atom.term);
    if (!key) continue;
    const prev = next[key] || { term: atom.term, type: atom.type, count: 0, lectureIds: [] };
    const ids = prev.lectureIds.includes(lectureId)
      ? prev.lectureIds
      : [...prev.lectureIds, lectureId];
    next[key] = { term: atom.term, type: atom.type, count: ids.length, lectureIds: ids };
  }
  return next;
}

/**
 * Annotate atoms with cross-lecture metadata before building a quiz round.
 *
 * @param {Array}  atoms          lecture atoms
 * @param {object} termIndex      the cross-lecture index (may be null)
 * @param {object} objectiveById  Map<id, objective> with .status field
 * @returns {{ toQuiz: Array, skipped: Array }}
 *   toQuiz  — atoms to actually quiz (sorted: high-yield first)
 *   skipped — atoms dropped because all linked objectives are mastered
 */
export function partitionAtomsForRound(atoms, termIndex, objectiveById) {
  const index = termIndex || {};
  const toQuiz = [];
  const skipped = [];

  for (const atom of (atoms || [])) {
    const key = normAtomKey(atom.term);
    const entry = index[key];
    const count = entry?.count ?? 1;
    const isHighYield = count >= 2;

    // Skip if every linked objective is already mastered and there is at least one
    const ids = atom.objectiveIds || [];
    const linked = ids.map((id) => objectiveById?.get(id)).filter(Boolean);
    const alreadyMastered = linked.length > 0 && linked.every((o) => o.status === "mastered");

    if (alreadyMastered) {
      skipped.push({ ...atom, isHighYield, crossCount: count });
    } else {
      toQuiz.push({ ...atom, isHighYield, crossCount: count });
    }
  }

  // High-yield atoms surface first within a round
  toQuiz.sort((a, b) => {
    if (a.isHighYield && !b.isHighYield) return -1;
    if (!a.isHighYield && b.isHighYield) return 1;
    return 0;
  });

  return { toQuiz, skipped };
}
