import { conceptName, conceptKey } from './conceptIdentity.js';
import { isIndependentAttempt } from './practiceAssistance.js';
import { schoolQuestionIdentity } from '../shell/features/exam/schoolSourceIdentity.js';

/** Original questions retained by the common answer journal, across every source. */
export function missedQuestionGroups(evidence = {}, { blockId, lectureId } = {}) {
  const latest = new Map();
  for (const event of [...(evidence.learningJournal || []), ...(evidence.assistedJournal || [])].sort((a,b)=>Number(a.at)-Number(b.at))) {
    if ((blockId && event.blockId !== blockId) || (lectureId && event.lectureId !== lectureId)) continue;
    const context = event.learningContext;
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
    const key = JSON.stringify([event.blockId, event.lectureId, conceptKey(question.topic)]);
    if (!groups.has(key)) groups.set(key, { key, lectureId: event.lectureId, concept: question.topic, questions: [], sources: new Set() });
    const group = groups.get(key);
    group.questions.push(question); group.sources.add(event.source || 'quiz');
  }
  return [...groups.values()].map(group=>({...group,sources:[...group.sources]}));
}
