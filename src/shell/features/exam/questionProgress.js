/** Use the study-answer log plus saved sessions, never the mixed lecture
 * counters that already include integrated exams (and older deleted attempts).
 */
export function questionProgress(studyAnswers = [], sessions = [], range = {}, manualEntries = [], historicalStudy = {}) {
  const inRange = ts => (range.startAt == null || ts >= range.startAt) && (range.endAt == null || ts <= range.endAt) && (!range.start || ts >= new Date(`${range.start}T00:00:00`).getTime()) && (!range.end || ts <= new Date(`${range.end}T23:59:59.999`).getTime());
  let lectureAnswered = 0;
  let correct = 0;
  const studySeen = new Set();
  for (const answer of studyAnswers) {
    if (!answer || typeof answer.correct !== 'boolean' || !Number.isFinite(answer.ts) || !answer.concept) continue;
    if (!inRange(answer.ts)) continue;
    const key = JSON.stringify([answer.ts, answer.concept]);
    if (studySeen.has(key)) continue;
    studySeen.add(key);
    lectureAnswered++;
    if (answer.correct) correct++;
  }
  // Legacy baseline has no reliable per-answer dates. Include it only in
  // lifetime totals; never move old aggregate history into today's score.
  if (range.startAt == null && range.endAt == null && !range.start && !range.end) {
    const count=Math.max(0,Number(historicalStudy.answered)||0);
    lectureAnswered+=count;correct+=Math.min(count,Math.max(0,Number(historicalStudy.correct)||0));
  }
  let schoolAnswered = 0;
  let examAnswered = 0;
  const seen = new Set();
  for (const session of sessions) {
    if (session.status && session.status !== 'submitted' && !session.isCheckpoint) continue;
    const id = session.sessionId || session.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const questions = new Map((session.questions || []).map(q => [q.questionId, q]));
    const answers = new Map((session.answers || []).map(a => [a.questionId, a]));
    for (const [questionId, answer] of answers) {
      const value = answer.value;
      const at = answer.answeredAt ?? session.submittedAt;
      if ((range.startAt != null || range.endAt != null || range.start || range.end) && (!Number.isFinite(at) || !inRange(at))) continue;
      const question = questions.get(questionId);
      if (!question || value == null || !Object.hasOwn(question.choices || {}, value)) continue;
      const school = session.sourceType === 'question-bank' || question.sourceType === 'question-bank';
      if (school) schoolAnswered++; else examAnswered++;
      if (value === question.correct) correct++;
    }
  }
  let manualAnswered = 0;
  let manualGraded = 0;
  for (const entry of manualEntries || []) {
    const ts = Number(entry?.completedAt);
    const count = Number(entry?.questionCount);
    if (Number.isFinite(ts) && Number.isInteger(count) && count > 0 && inRange(ts)) {
      manualAnswered += count;
      if (entry.correctCount != null && entry.correctCount !== '' && Number.isInteger(Number(entry.correctCount)) && Number(entry.correctCount) >= 0 && Number(entry.correctCount) <= count) {
        manualGraded += count; correct += Number(entry.correctCount);
      }
    }
  }
  const gradedAnswered = lectureAnswered + schoolAnswered + examAnswered + manualGraded;
  const answered = lectureAnswered + schoolAnswered + examAnswered + manualAnswered;
  return {answered, correct, lectureAnswered, schoolAnswered, examAnswered, manualAnswered, gradedAnswered, accuracy: gradedAnswered ? correct / gradedAnswered : null};
}
