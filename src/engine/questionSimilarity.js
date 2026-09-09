const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "by", "describes", "following",
  "for", "from", "has", "have", "history", "in", "is", "it", "likely", "most", "of",
  "on", "patient", "presents", "the", "this", "to", "which", "with", "year", "old",
  "male", "female", "man", "woman", "boy", "girl",
]);

export function comparableQuestionTokens(question) {
  const text = [question?.stem, ...Object.values(question?.choices || {})]
    .map((value) => typeof value === "string" ? value : JSON.stringify(value || ""))
    .join(" ")
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");
  return new Set(text.split(/\s+/).filter((word) => word.length > 2 && !STOP_WORDS.has(word)));
}

export function questionSimilarity(left, right) {
  const a = comparableQuestionTokens(left);
  const b = comparableQuestionTokens(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

export function areNearDuplicateQuestions(left, right, threshold = 0.9) {
  if (!left || !right) return false;
  const objectiveOverlap = !(left.objectiveIds?.length && right.objectiveIds?.length) ||
    left.objectiveIds.some((id) => right.objectiveIds.includes(id));
  return objectiveOverlap && questionSimilarity(left, right) >= threshold;
}

export function uniqueQuestions(questions = [], existing = []) {
  const accepted = [];
  for (const question of questions) {
    if ([...existing, ...accepted].some((other) => areNearDuplicateQuestions(question, other))) continue;
    accepted.push(question);
  }
  return accepted;
}
