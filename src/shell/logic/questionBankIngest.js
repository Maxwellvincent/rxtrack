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

const ANSWER_FILE_HINT = /\b(?:answer(?:s)?|key|breakdown|solution(?:s)?|explanation(?:s)?)\b/i;

function normalizedQuestionBankTitle(name) {
  return String(name || "")
    .replace(/\.(?:pdf|md|markdown|txt)$/i, "")
    .replace(/\+/g, " ")
    .replace(/\b(?:answer(?:s)?|key|breakdown|solution(?:s)?|explanation(?:s)?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Prefer an original PDF when a folder also contains its generated Markdown extraction. */
export function selectQuestionBankFiles(files = []) {
  const rank = (file) => {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".pdf")) return 3;
    if (name.endsWith(".md") || name.endsWith(".markdown")) return 2;
    if (name.endsWith(".txt")) return 1;
    return 0;
  };
  const selected = new Map();
  for (const file of Array.from(files || [])) {
    if (!rank(file)) continue;
    const key = String(file?.name || "")
      .replace(/\.(?:pdf|md|markdown|txt)$/i, "")
      .replace(/\+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const previous = selected.get(key);
    if (!previous || rank(file) > rank(previous)) selected.set(key, file);
  }
  return [...selected.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
}

/** Match a standalone answer/rationale file with its question companion. */
export function pairQuestionBankFiles(files = []) {
  const selected = Array.from(files || []);
  const answerFiles = selected.filter((file) => ANSWER_FILE_HINT.test(String(file?.name || "")) && !/IMCQ/i.test(String(file?.name || "")));
  const questionFiles = selected.filter((file) => !ANSWER_FILE_HINT.test(String(file?.name || "")));
  return answerFiles.flatMap((answerFile) => {
    const answerTitle = normalizedQuestionBankTitle(answerFile.name);
    const questionFile = questionFiles.find((candidate) => normalizedQuestionBankTitle(candidate.name) === answerTitle);
    return questionFile ? [{ questionFile, answerFile }] : [];
  });
}

/** Extract numbered letter keys plus the explanation that follows each key. */
export function extractPairedAnswerKey(text = "") {
  const records = new Map();
  const source = String(text || "").replace(/\r/g, "");
  const answerPattern = /(?:^|\n|\f)\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s+Answer\s*:\s*([A-H])\s*[.)]?\s*([\s\S]*?)(?=(?:\n|\f)\s*(?:Q(?:uestion)?\s*)?\d{1,3}\s+Answer\s*:|$)/gi;
  for (const match of source.matchAll(answerPattern)) {
    records.set(Number(match[1]), { correct: match[2].toUpperCase(), explanation: match[3].replace(/\s+/g, " ").trim() });
  }
  return records;
}

/**
 * Stamp parsed questions with where they came from.
 *
 * `wrongOnly` marks a bank of questions the student got wrong, which generation
 * weights differently from a neutral past paper.
 */
export function tagBankQuestions(questions, { blockId, filename, wrongOnly = false, sourceKind = "school", idgen, now = () => new Date().toISOString() }) {
  return (questions || [])
    .filter((q) => q && (q.stem || q.question))
    .map((q) => ({
      ...q,
      id: q.id || newId(idgen),
      blockId: blockId ?? null,
      sourceFile: filename,
      importedAt: now(),
      bankType: wrongOnly ? "wrong" : "neutral",
      sourceKind: q.sourceKind || sourceKind,
      // This describes the imported document's key, not medical correctness.
      // Keeping the distinction explicit prevents a present answer key from
      // being mistaken for an independent content audit.
      sourceKeyStatus: q.sourceKeyStatus || (q.correct && q.choices?.[q.correct] ? "present" : "missing"),
    }));
}

/** What the modal reports after a batch, and what the caller writes. */
export function summarizeBankUpload(results) {
  const ok = (results || []).filter((r) => r.questions?.length);
  return {
    files: (results || []).length,
    saved: ok.length,
    empty: (results || []).filter((r) => !r.error && !r.report && !r.questions?.length).map((r) => r.filename),
    failed: (results || []).filter((r) => r.error).map((r) => `${r.filename}: ${r.error}`),
    questions: ok.reduce((n, r) => n + r.questions.length, 0),
    reports: (results || []).filter((r) => r.report).length,
  };
}
