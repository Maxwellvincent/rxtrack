// Reporting a quality problem never deletes an answer or changes the source key.
export const QUESTION_REPORT_CATEGORIES = [
 ['invalid-choices', 'Invalid answer choices', 'performance'],
 ['incorrect-key', 'Incorrect answer key', 'performance'],
 ['multiple-answers', 'Multiple valid answers', 'performance'],
 ['medical-explanation', 'Incorrect medical explanation', 'performance'],
 ['incomplete-explanation', 'Incomplete explanation', 'none'],
 ['source-mismatch', 'Lecture or objective mismatch', 'objective'],
];
export function reportProtection(rating = {}) {
 const category = QUESTION_REPORT_CATEGORIES.find(([id]) => id === rating.sourceIssue);
 return {
  performance: rating.excludeFromPerformance ?? (category?.[2] === 'performance'),
  objective: rating.excludeFromObjectives ?? (!!rating.sourceIssue && category?.[2] !== 'none'),
 };
}
export function evidenceIdentity(value) {
 const input = String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
 if (!input || /^e_[a-z0-9]+$/.test(input)) return input;
 let hash = 2166136261;
 for (let i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
 return `e_${(hash >>> 0).toString(36)}`;
}
export function questionIdentityValues(question = {}) {
 return [...new Set([question.questionKey, question.poolId, (!question.sourceFile || !question.questionKey) && question.id, question.questionId, question.stem && `stem:${question.stem}`].filter(Boolean))];
}
export function excludedEvidenceKeys(ratings, scope = 'performance') {
 return new Set(Object.values(ratings || {}).filter(r => reportProtection(r)[scope]).flatMap(r => [r.evidenceKey, ...(r.evidenceAliases || [])]).filter(Boolean).map(evidenceIdentity));
}
export function questionIsExcluded(question, ratings, scope = 'performance') {
 const excluded = excludedEvidenceKeys(ratings, scope);
 return questionIdentityValues(question).some(value => excluded.has(evidenceIdentity(value)));
}
export function protectSessionScoring(session, ratings = {}) {
 const excluded = new Set((session.questions || []).filter(q => questionIsExcluded(q, ratings)).map(q => q.questionId));
 const objectiveExcluded = (session.questions || []).some(q => questionIsExcluded(q, ratings, 'objective'));
 if (!excluded.size && !objectiveExcluded) return session;
 return { ...session,
  originalAnswers: session.originalAnswers || session.answers,
  scoringExcludedQuestionIds: [...excluded],
  answers: (session.answers || []).filter(a => !excluded.has(a.questionId)),
  questions: (session.questions || []).map(q => questionIsExcluded(q, ratings, 'objective') ? { ...q, originalObjectiveIds: q.objectiveIds, objectiveIds: [] } : q),
 };
}
