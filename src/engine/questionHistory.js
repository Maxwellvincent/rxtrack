// One stable identity per question for answer history. School banks number
// their items q1, q2… independently, so a bank-local id would merge different
// questions; original school items are keyed by their normalized stem instead.
const isOriginalSchoolItem = (q = {}) => !q.poolId && (q.sourceRepresentation === "original-school-question" || q.sourceType === "question-bank" || (!!q.sourceFile && /^q\d+$/i.test(String(q.id || ""))));

export function quizAnswerKey(q = {}) {
  if (isOriginalSchoolItem(q)) return `school:${String(q.stem || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 240)}`;
  return q.poolId || q.id || q.questionId || q.questionKey || `stem:${q.stem || ""}`;
}

/** Past answers to one question (by evidence key): oldest result first. */
export function questionHistory(journal = [], evidenceKey) {
  if (!evidenceKey) return null;
  const events = (journal || []).filter((event) => event?.questionKey === evidenceKey && typeof event.correct === "boolean")
    .sort((a, b) => (a.at || 0) - (b.at || 0));
  if (!events.length) return null;
  return { count: events.length, correct: events.filter((event) => event.correct).length, results: events.map((event) => event.correct), lastAt: events.at(-1).at || null };
}

export function answeredQuestionKeys(journal = []) {
  return new Set((journal || []).filter((event) => event?.questionKey && typeof event.correct === "boolean").map((event) => event.questionKey));
}
