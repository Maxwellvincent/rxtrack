import { conceptName, conceptKey } from './conceptIdentity.js';
import { isIndependentAttempt } from './practiceAssistance.js';
import { schoolQuestionIdentity } from '../shell/features/exam/schoolSourceIdentity.js';

/** Original questions retained by the common answer journal, across every source. */
export function missedQuestionGroups(evidence = {}, { blockId, lectureId, dismissed = null } = {}) {
  const learned = dismissed?.ids || {};
  const latest = new Map();
  for (const event of [...(evidence.learningJournal || []), ...(evidence.assistedJournal || [])].sort((a,b)=>Number(a.at)-Number(b.at))) {
    if ((blockId && event.blockId !== blockId) || (lectureId && event.lectureId !== lectureId)) continue;
    const context = event.learningContext;
    // An independent correct redo keeps only the question's identity; it still clears the miss.
    if (!context?.stem && context?.identity && event.correct && isIndependentAttempt(event)) {
      if (latest.has(context.identity)) latest.set(context.identity, { event, question: latest.get(context.identity).question });
      continue;
    }
    if (!context?.stem || !context.choices || !context.correctLetter) continue;
    const question = { ...context, correct: context.correctLetter, lectureId: event.lectureId, objectiveIds: event.objectiveIds || [], source: event.source, topic: conceptName(context.topic, context.keyed) };
    const identity = schoolQuestionIdentity(question);
    // Guided correct answers do not clear an independent miss.
    if (event.correct && !isIndependentAttempt(event)) continue;
    latest.set(identity, { event, question: { ...question, questionId: identity } });
  }
  const groups = new Map();
  for (const {event, question} of latest.values()) {
    if (event.correct) continue;
    // Marked learned after this miss: hidden until a newer miss brings it back.
    if (learned[question.questionId] && Number(learned[question.questionId]) >= Number(event.at || 0)) continue;
    const key = JSON.stringify([event.blockId, event.lectureId, conceptKey(question.topic)]);
    if (!groups.has(key)) groups.set(key, { key, lectureId: event.lectureId, concept: question.topic, questions: [], sources: new Set() });
    const group = groups.get(key);
    group.questions.push(question); group.sources.add(event.source || 'quiz');
  }
  return [...groups.values()].map(group=>({...group,sources:[...group.sources]}));
}
