/**
 * Pure shaping helpers for the shell's data. No storage reads.
 *
 * `readTerms`/`readLectures` used to live here and read localStorage directly.
 * They are gone: a component calling them inside a `useMemo` saw whatever was in
 * localStorage before the first Firestore snapshot landed and never updated,
 * which is how BlockHome came to show "Select a block to begin." with a block
 * plainly selected in the sidebar. Use the hooks (useBlocks / useLectures) or
 * the stores directly.
 */

/** Flatten terms→blocks with term metadata + per-block lecture count. */
export function flattenBlocks(terms, lectures) {
  const lecs = Array.isArray(lectures) ? lectures : [];
  return (Array.isArray(terms) ? terms : []).flatMap((t) =>
    (t.blocks || []).map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      termId: t.id,
      termName: t.name,
      termColor: t.color,
      lectureCount: lecs.filter((l) => l && l.blockId === b.id).length,
    }))
  );
}

/**
 * Flatten a rxt-block-objectives entry to a flat objective array. Mirrors the
 * shapes App.jsx supports: flat array, {imported, extracted}, or a numeric-keyed
 * object ({0:{…},1:{…}} or {0:[…],1:[…]}).
 */
export function flattenObjectiveEntry(entry) {
  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  if (typeof entry !== "object") return [];
  if (Array.isArray(entry.imported) || Array.isArray(entry.extracted)) {
    return [...(entry.imported || []), ...(entry.extracted || [])];
  }
  const vals = Object.values(entry);
  if (vals.length === 0) return [];
  if (vals.every((v) => Array.isArray(v))) return vals.flat();
  if (vals.every((v) => v && typeof v === "object" && v.id != null)) return vals;
  return vals.filter((v) => v && typeof v === "object");
}

/**
 * Average objective coverage % for a block, or null.
 *
 * Takes the objectives map rather than reading localStorage itself: the caller
 * has it from the store, which is reactive and complete. Reading the mirrored
 * copy here meant the figure was missing for any block the HOT_BLOCK_LIMIT had
 * evicted, and stale until a reload.
 */
export function blockCoverage(objectives, blockId) {
  try {
    const list = flattenObjectiveEntry((objectives || {})[blockId]);
    const scores = list.map((o) => (typeof o?.score === "number" ? o.score : null)).filter((s) => s != null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  } catch { return null; }
}
