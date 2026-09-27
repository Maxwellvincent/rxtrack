/** Use the study-answer log plus saved sessions, never the mixed lecture
 * counters that already include integrated exams (and older deleted attempts).
 */
export function questionProgress(studyAnswers = [], sessions = [], range = {}, manualEntries = []) {
  const inRange = ts => (!range.start || ts >= new Date(`${range.start}T00:00:00`).getTime()) && (!range.end || ts <= new Date(`${range.end}T23:59:59.999`).getTime());
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
  let schoolAnswered = 0;
  let examAnswered = 0;
  const seen = new Set();
  for (const session of sessions) {
    if (session.status && session.status !== 'submitted') continue;
    if (!inRange(session.submittedAt)) continue;
    const id = session.sessionId || session.id;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const questions = new Map((session.questions || []).map(q => [q.questionId, q]));
    const answers = new Map((session.answers || []).map(a => [a.questionId, a.value]));
    for (const [questionId, value] of answers) {
      const question = questions.get(questionId);
      if (!question || value == null || !Object.hasOwn(question.choices || {}, value)) continue;
      const school = session.sourceType === 'question-bank' || question.sourceType === 'question-bank';
      if (school) schoolAnswered++; else examAnswered++;
      if (value === question.correct) correct++;
    }
  }
  let manualAnswered = 0;
  for (const entry of manualEntries || []) {
    const ts = Number(entry?.completedAt);
    const count = Number(entry?.questionCount);
    if (Number.isFinite(ts) && Number.isInteger(count) && count > 0 && inRange(ts)) manualAnswered += count;
  }
  const gradedAnswered = lectureAnswered + schoolAnswered + examAnswered;
  const answered = gradedAnswered + manualAnswered;
  return {answered, correct, lectureAnswered, schoolAnswered, examAnswered, manualAnswered, gradedAnswered, accuracy: gradedAnswered ? correct / gradedAnswered : null};
}
