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
    // Normalize interchangeable experimental labels only for duplicate comparison.
    // Keep the intervention, anatomical route and endpoint tokens intact.
    .replace(/\b(?:(?:fluorescent|radioactive|radiolabeled|radio-labelled|radiolabelled|labeled|labelled|tagged)\s+(?:tracer|marker|molecule|substance|compound|precursor)|tracer|dye)\b/g, "tracer")
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
  // Reworded options must not disguise an almost identical clinical/task stem.
  const stemSimilarity = questionSimilarity({ stem: left.stem }, { stem: right.stem });
  const answer = q => String(q.choices?.[q.correct] || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const routeOverlap = ["perturbation", "endpoint"].every(field => {
    const a = { stem: left.questionPlan?.[field] };
    const b = { stem: right.questionPlan?.[field] };
    return comparableQuestionTokens(a).size >= 3 && comparableQuestionTokens(b).size >= 3 && questionSimilarity(a, b) >= 0.85;
  });
  return objectiveOverlap && (questionSimilarity(left, right) >= threshold || stemSimilarity >= threshold ||
    (routeOverlap && answer(left) && answer(left) === answer(right)));
}

export function uniqueQuestions(questions = [], existing = []) {
  const accepted = [];
  for (const question of questions) {
    if ([...existing, ...accepted].some((other) => areNearDuplicateQuestions(question, other))) continue;
    accepted.push(question);
  }
  return accepted;
}
