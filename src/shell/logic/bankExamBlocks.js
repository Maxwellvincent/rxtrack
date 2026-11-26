// Which exams a school question bank counts for. A bank is filed under one
// block, but an IMCQ or ESoft quiz given during NB 3 can test NB 2 lectures,
// and NB 3 is then the exam it prepares for. The learner can mark a bank as
// another block's exam material: it then appears in that block's bank list and
// shapes that block's question wording, while its lecture and objective links
// stay on the lectures its questions actually test.

/** Blocks the learner marked this bank as exam material for. */
export function markedExamBlockIds(entry) {
  return Array.isArray(entry?.examBlockIds) ? entry.examBlockIds.filter(Boolean) : [];
}

/** Filed block, block where linking found it was taught, and marked exams. */
export function bankBlockIds(entry) {
  return [...new Set([entry?.blockId, entry?.mappingProgress?.scope?.homeBlockId, ...markedExamBlockIds(entry)].filter(Boolean))];
}

/** Whether a bank belongs in a block's question bank list. */
export function listedForBlock(entry, blockId) {
  return !!blockId && (entry?.blockId === blockId || markedExamBlockIds(entry).includes(blockId));
}

/** Meta with `filename` marked (or unmarked) as `blockId` exam material. */
export function withExamBlock(meta = {}, filename, blockId, marked) {
  const next = {};
  for (const [id, entry] of Object.entries(meta || {})) {
    if (entry?.filename !== filename) { next[id] = entry; continue; }
    const current = markedExamBlockIds(entry).filter(id2 => id2 !== blockId);
    next[id] = { ...entry, examBlockIds: marked && blockId !== entry.blockId ? [...current, blockId] : current };
  }
  return next;
}
