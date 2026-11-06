const normalized = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const signature = q => JSON.stringify([normalized(q.stem || q.question), Object.entries(q.choices || {}).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, normalized(v)]), q.correct || null, q.sourceImageFingerprint || null]);
const hash = value => { let h = 2166136261; for (const c of value) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };

/** Daily source updates are additive: keep prior items and learner identities. */
export function refreshQuestionBank(previous = [], incoming = []) {
  const result = [...previous];
  const indexes = new Map(previous.map((q, index) => [signature(q), index]));
  const usedIds = new Set(previous.map(q => q.id));
  let added = 0, unchanged = 0, revised = 0;
  for (const q of incoming) {
    const sig = signature(q);
    const index = indexes.get(sig);
    if (index != null) {
      // Preserve completed links and the stable ID used by saved attempts.
      const old = result[index];
      result[index] = { ...old, ...q, id: old.id, importedAt: old.importedAt || q.importedAt,
        ...(old.objectiveIds?.length ? { objectiveIds: old.objectiveIds } : {}),
        ...(old.lectureIds?.length ? { lectureIds: old.lectureIds } : {}),
      };
      if (old.sourceImageUrl) {
        result[index].sourceImageUrl = old.sourceImageUrl;
        delete result[index].sourceImageDataUrl;
      }
      unchanged++;
    } else {
      const collision = usedIds.has(q.id);
      const id = collision ? `${q.id}-revision-${hash(sig)}` : q.id;
      if (collision) revised++;
      indexes.set(sig, result.length); usedIds.add(id);
      result.push({ ...q, id }); added++;
    }
  }
  return { questions: result, added, unchanged, revised, retained: previous.length - unchanged };
}
