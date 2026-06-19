/** Read + shape the shell's data from localStorage. Self-contained — no App.jsx. */

export function readTerms() {
  try { return JSON.parse(localStorage.getItem("rxt-terms") || "[]"); }
  catch { return []; }
}

export function readLectures() {
  try { return JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]"); }
  catch { return []; }
}

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

/** Average objective coverage % for a block, or null. Reads rxt-block-objectives. */
export function blockCoverage(blockId) {
  try {
    const store = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
    const entry = store[blockId];
    const list = Array.isArray(entry)
      ? entry
      : entry && typeof entry === "object"
      ? [...(entry.imported || []), ...(entry.extracted || [])]
      : [];
    const scores = list.map((o) => (typeof o?.score === "number" ? o.score : null)).filter((s) => s != null);
    if (!scores.length) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  } catch { return null; }
}
