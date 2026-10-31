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

/** Letter balance is not conceptual variety: compare the keyed answer text. */
export function questionAnswerKey(question = {}) {
  const value = question.choices?.[question.correct];
  return (typeof value === 'string' ? value : '').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/^the /,'').trim();
}
export function exceedsAnswerConcentration(question, accepted = [], plannedCount = 15) {
  const key = questionAnswerKey(question);
  if (!key) return false;
  const limit = Math.max(2, Math.ceil(Math.max(1, Number(plannedCount) || 1) * .2));
  return accepted.filter(item => questionAnswerKey(item) === key).length >= limit;
}
export function repeatedSuccessfulAnswerGuidance(history = []) {
  const counts = new Map();
  const seen = new Set();
  for (const question of history) {
    const key = questionAnswerKey(question);
    const identity = question.questionId || question.id || String(question.stem || '').trim().toLowerCase() || question;
    if (seen.has(identity)) continue;
    seen.add(identity);
    if (key && question.lastCorrect === true && Number(question.timesCorrect) > 0) counts.set(key, (counts.get(key) || 0) + Math.floor(Number(question.timesCorrect)));
  }
  const repeated = [...counts].filter(([,count])=>count>=2).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([answer,count])=>({answer,correctAttempts:count}));
  return repeated.length ? `RECENTLY REPEATED SUCCESSFUL ANSWERS (learner history, not factual authority): ${JSON.stringify(repeated)}. Avoid another easy question asking for these same answers from the same findings. Use a different source-supported endpoint, supported integration when allocated, or the other allocated objectives. Do not invent relationships to increase difficulty.` : '';
}

/** Observed facet labels guide variety; they do not establish complete objective coverage. */
export function objectiveFacetHistoryGuidance(history = [], objectives = []) {
 const ids = new Set(objectives.map(o=>String(o.id || o.code)));
 const rows = new Map();
 for(const question of history){
  if(!(Number(question.timesAnswered)>0 || typeof question.lastCorrect==='boolean'))continue;
  const facet=String(question.objectiveFacet || '').trim();
  if(!facet)continue;
  for(const id of question.objectiveIds || []){
   if(!ids.has(String(id)))continue;
   const key=JSON.stringify([id,facet.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(),questionAnswerKey(question)]);
   rows.set(key,{objectiveId:id,facet:facet.slice(0,200),answer:questionAnswerKey(question).slice(0,200),lastCorrect:question.lastCorrect ?? null});
  }
 }
 const selected=[...rows.values()].slice(-24);
 return selected.length ? `PREVIOUSLY ANSWERED OBJECTIVE FACETS (history labels only, not medical authority or complete coverage): ${JSON.stringify(selected)}. Read each full assigned objective and its lecture evidence. Prefer a supported clause or relationship not represented here before repeating a successful facet. A prior miss may receive a fresh near-transfer repair; do not repeat the same clue-to-answer route. Different labels may describe the same relationship, so judge meaning. Do not assume an unlisted facet is untested or invent content to fill it. Keep the assigned objective allocation and depth floor.` : '';
}
