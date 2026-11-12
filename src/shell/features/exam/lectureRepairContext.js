import {isIndependentAttempt} from '../../../engine/practiceAssistance.js';
import { objectivePracticePlan, OBJECTIVE_MIN_ACCURACY } from '../../../engine/objectivePractice.js';
import { protectSessionScoring } from '../../../engine/questionScoringPolicy.js';
import { questionEvidenceKey } from '../../../stores/learnerEvidence.js';
import { schoolQuestionIdentity } from './schoolSourceIdentity.js';

const timestamp = value => Number(value?.toMillis?.() ?? value) || 0;

/** Read-only repair handoff. Published answers establish targets; manual labels do not. */
export function buildLectureRepairContext(sessions = [], lectureId, objectives = [], learnerEvidence = {}, reportWeaknesses = []) {
  const events = new Map();
  for (const saved of sessions) {
    const published = saved.status === 'submitted' ? saved.answers
      : saved.status === 'in_progress' && saved.progressSavedAt ? saved.checkpointAnswers : null;
    if (!published) continue;
    const session = protectSessionScoring({ ...saved, answers: published });
    const excluded = new Set(saved.scoringExcludedQuestionIds || []);
    const answers = new Map((session.answers || []).map(answer => [answer.questionId, answer]));
    for (const question of session.questions || []) {
      const answer = answers.get(question.questionId);
      if (!isIndependentAttempt(question) || !isIndependentAttempt(answer) || excluded.has(question.questionId) || question.lectureId !== lectureId || !answer || !Object.hasOwn(question.choices || {}, question.correct)
        || !Object.hasOwn(question.choices || {}, answer.value)) continue;
      const at = timestamp(answer.answeredAt) || timestamp(saved.status === 'submitted' ? saved.submittedAt : saved.progressSavedAt) || timestamp(saved.startedAt);
      const sessionKey = saved.sessionId || saved.id || `legacy:${timestamp(saved.submittedAt)}`;
      const key = `${sessionKey}:${question.questionId}`;
      const event = { question, answer, at, sessionKey, correct: answer.value === question.correct, title: saved.title || 'Saved practice', sourceFile: saved.sourceFile };
      if (!events.has(key) || at >= events.get(key).at) events.set(key, event);
    }
  }
  const ordered = [...events.values()].sort((a, b) => a.at - b.at || Number(a.correct) - Number(b.correct));
  const latest = new Map();
  const projected = {};
  for (const event of ordered) {
    latest.set(schoolQuestionIdentity(event.question), event);
    for (const id of new Set(event.question.objectiveIds || [])) {
      const row = projected[id] ||= { attempts: 0, correct: 0, recent: [], sessions: [] };
      row.attempts++;
      row.correct += Number(event.correct);
      row.recent = [...row.recent, event.correct].slice(-8);
      if (!row.sessions.includes(event.sessionKey)) row.sessions.push(event.sessionKey);
    }
  }
  const own = objectives.filter(objective => (objective.linkedLecId || objective.lectureId) === lectureId);
  // A durable zero entry can explicitly withdraw evidence, so never replace it with old sessions.
  const evidence = { ...learnerEvidence, objectives: { ...projected, ...learnerEvidence.objectives } };
  const plan = objectivePracticePlan(own, evidence);
  const performance = row => {
    const recent = evidence.objectives[row.id]?.recent || [];
    return recent.length >= 3 ? { attempts: recent.length, correct: recent.filter(Boolean).length }
      : { attempts: row.attempts, correct: row.correct };
  };
  const targets = plan.rows.filter(row => {
    const current = performance(row);
    return row.worked && (row.state === 'struggling' || !row.latestCorrect || current.correct / current.attempts < OBJECTIVE_MIN_ACCURACY);
  }).sort((a, b) => Number(b.latestMiss) - Number(a.latestMiss)
    || performance(a).correct / performance(a).attempts - performance(b).correct / performance(b).attempts);
  const journal = (learnerEvidence.evidenceJournal || []).filter(event => isIndependentAttempt(event) && event.lectureId === lectureId && typeof event.correct === 'boolean');
  const unresolved = [...latest.values()].filter(event => {
    if (event.correct) return false;
    const aliases = new Set([schoolQuestionIdentity(event.question), ...[event.question.questionKey, event.question.poolId, event.question.id, `stem:${event.question.stem}`].filter(Boolean).map(questionEvidenceKey)]);
    const newer = journal.filter(answer => timestamp(answer.at) >= event.at && aliases.has(questionEvidenceKey(answer.questionKey)))
      .sort((a, b) => timestamp(b.at) - timestamp(a.at) || Number(b.correct) - Number(a.correct))[0];
    return newer ? !newer.correct : true;
  }).sort((a, b) => b.at - a.at);
  const missedQuestions = unresolved.slice(0, 5).map(({ question, answer, at, title, sessionKey, sourceFile }) => ({
    key: `${sessionKey}:${question.questionId}`, title, submittedAt: at,
    stem: question.stem || question.prompt || 'Question text unavailable',
    selected: question.choices[answer.value], correct: question.choices[question.correct],
    objectiveIds: question.objectiveIds || [], explanation: question.explanation || '',
    sourceFile: question.sourceFile || sourceFile || null, sourceSection: question.sourceSectionTitle || question.sourceLectureClue || null,
  }));
  const concepts = new Map();
  for (const { question } of unresolved) {
    const linked = own.filter(objective => question.objectiveIds?.includes(objective.id));
    const label = question.objectiveFacet || question.topic || linked.map(objective => objective.objective || objective.text).filter(Boolean).join('; ');
    if (label) concepts.set(String(label).toLowerCase().replace(/\W+/g, ' ').trim(), String(label));
  }
  return {
    reportTopics: [...new Set(reportWeaknesses.filter(entry => entry.masteryLevel === 'struggling' && entry.tags?.includes('exam-report') && entry.linkedLecIds?.includes(lectureId)).map(entry => entry.concept).filter(Boolean))],
    focusObjectiveIds: targets.map(row => row.id),
    weakObjectives: targets.map(row => { const current = performance(row); return {id: row.id, label: row.text, misses: current.attempts - current.correct, attempts: current.attempts}; }),
    conceptsToReview: [...concepts.values()].slice(0, 6),
    missedQuestions,
  };
}
