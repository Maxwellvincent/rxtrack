/**
 * Uploaded exam questions, prepared for storage.
 *
 * Ported from App's question-bank upload, minus its AI enrichment layers: App
 * also asked a model to pull testable facts out of every bank and attach them to
 * lectures and weak concepts. The bank itself is what feeds question generation
 * as few-shot exemplars, and that is the part worth keeping.
 *
 * Pure — the caller parses the PDF and owns the store write.
 */

const newId = (idgen) =>
  idgen?.() ??
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `qb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/**
 * Stamp parsed questions with where they came from.
 *
 * `wrongOnly` marks a bank of questions the student got wrong, which generation
 * weights differently from a neutral past paper.
 */
export function tagBankQuestions(questions, { blockId, filename, wrongOnly = false, idgen, now = () => new Date().toISOString() }) {
  return (questions || [])
    .filter((q) => q && (q.stem || q.question))
    .map((q) => ({
      ...q,
      id: q.id || newId(idgen),
      blockId: blockId ?? null,
      sourceFile: filename,
      importedAt: now(),
      bankType: wrongOnly ? "wrong" : "neutral",
    }));
}

/** What the modal reports after a batch, and what the caller writes. */
export function summarizeBankUpload(results) {
  const ok = (results || []).filter((r) => r.questions?.length);
  return {
    files: (results || []).length,
    saved: ok.length,
    empty: (results || []).filter((r) => !r.error && !r.questions?.length).map((r) => r.filename),
    failed: (results || []).filter((r) => r.error).map((r) => `${r.filename}: ${r.error}`),
    questions: ok.reduce((n, r) => n + r.questions.length, 0),
  };
}
