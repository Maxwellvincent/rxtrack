/** Use the study-answer log plus saved sessions, never the mixed lecture
 * counters that already include integrated exams (and older deleted attempts).
 */
export function questionProgress(studyAnswers = [], sessions = []) {
  let lectureAnswered = 0;
  let correct = 0;
  const studySeen = new Set();
  for (const answer of studyAnswers) {
    if (!answer || typeof answer.correct !== 'boolean' || !Number.isFinite(answer.ts) || !answer.concept) continue;
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
  const answered = lectureAnswered + schoolAnswered + examAnswered;
  return {answered, correct, lectureAnswered, schoolAnswered, examAnswered, accuracy: answered ? correct / answered : null};
}
