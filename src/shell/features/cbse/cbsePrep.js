import { questionEvidenceKey } from "../../../stores/learnerEvidence.js";
import { prepareQuestionBankQuestions, validBankQuestion } from "../exam/launchQuestionBank.js";
import { flattenObjectiveEntry } from "../../data.js";
import { objectivePracticePlan } from "../../../engine/objectivePractice.js";
export const CBSE_BLOCK_ID = "cbse-prep";
export const CBSE_OWNER = "KX9K9IK4DgU0dBoAD6pj6Q4CEgr1";
export function ensureCbseTerms(terms = [], userId) {
  if (userId !== CBSE_OWNER || terms.some(term => term.blocks?.some(block => block.id === CBSE_BLOCK_ID))) return terms;
  return [...terms, { id: "comprehensive-prep", name: "Comprehensive", blocks: [{ id: CBSE_BLOCK_ID, name: "CBSE Prep", kind: "cbse", status: "active", examDate: "2026-12-09", examWindowEnd: "2026-12-10" }] }];
}
const normalize = value => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
export function cbseQuestionKey(question) {
  return questionEvidenceKey(JSON.stringify([normalize(question.stem), Object.values(question.choices || {}).map(normalize).sort(), normalize(question.choices?.[question.correct])]));
}
const time = value => typeof value === "number" ? value : new Date(value || 0).getTime() || 0;
export function buildCbsePool(banks = {}, metadata = {}, lectures = [], terms = []) {
  const blockNames = new Map(terms.flatMap(term => (term.blocks || []).map(block => [block.id, { name: block.name, term: term.name }])));
  const meta = new Map(Object.values(metadata).map(entry => [entry.filename, entry]));
  const pool = new Map(); let excluded = 0, duplicates = 0;
  for (const [filename, questions] of Object.entries(banks)) {
    const sourceBlockId = meta.get(filename)?.blockId || null;
    const sourceLectures = lectures.filter(lecture => !sourceBlockId || lecture.blockId === sourceBlockId);
    // Exact deduplication below is linear across the entire library. Preparing
    // one original item at a time avoids the bank runner's quadratic near-duplicate pass.
    for (const [index, original] of (Array.isArray(questions) ? questions : []).entries()) {
      const [question] = prepareQuestionBankQuestions([{ ...original, sourceQuestionNumber: original?.sourceQuestionNumber ?? original?.num ?? index+1 }], { filename, blockId: sourceBlockId, lectures: sourceLectures });
      if (!validBankQuestion(question)) { excluded++; continue; }
      const key = cbseQuestionKey(question);
      if (pool.has(key)) { duplicates++; continue; }
      const block = blockNames.get(sourceBlockId);
      pool.set(key, { ...question, questionId: `cbse:${key}`, questionKey: `cbse:${key}`, sourceBlockId,
        blockId: sourceBlockId, sourceBlockName: block?.name || "Unassigned source", sourceTermName: block?.term || "Unassigned term", sourceKind: meta.get(filename)?.sourceKind || "school" });
    }
  }
  return { questions: [...pool.values()], excluded, duplicates, sources: Object.keys(banks).length };
}
export function uniqueSessions(sessions = []) {
  return [...new Map(sessions.filter(s => s?.sessionId || s?.id).map(s => [s.sessionId || s.id, s])).values()];
}
export function cbseProgress({ sessions = [], calibration = {}, weakConcepts = {}, objectives = {}, evidence = {}, lectures = [] } = {}) {
  const lectureMap = new Map(lectures.map(lecture => [lecture.id, lecture]));
  const rows = new Map(), history = [], itemHistory = new Map();
  let answered = 0, correct = 0, unlinked = 0;
  const record = (rowId, label, blockId, lectureId, isCorrect, at, questionKey, objectiveIds = []) => {
    answered++; correct += Number(isCorrect); if (!objectiveIds.length) unlinked++;
    const row = rows.get(rowId) || { id: rowId, label, blockId, lectureId, answered: 0, correct: 0 };
    row.answered++; row.correct += Number(isCorrect); rows.set(rowId, row);
    const prior = itemHistory.get(questionKey);
    if (!prior || at >= prior.at) itemHistory.set(questionKey, { correct: isCorrect, at });
  };
  for (const session of uniqueSessions(sessions).filter(s => s.status === "submitted")) {
    const answers = new Map((session.answers || []).map(answer => [answer.questionId, answer]));
    let total = 0, right = 0;
    for (const question of session.questions || []) {
      const answer = answers.get(question.questionId);
      if (!answer || !Object.hasOwn(question.choices || {}, answer.value)) continue;
      const lecture = lectureMap.get(question.lectureId), blockId = question.sourceBlockId || question.blockId || lecture?.blockId || session.blockId;
      const label = question.topic || question.concept || question.sourceSectionTitle || lecture?.lectureTitle || question.sourceFile || "Unlinked school question";
      const isCorrect = answer.value === question.correct;
      record(`${blockId}:${normalize(label)}`, label, blockId, question.lectureId, isCorrect, time(answer.answeredAt || session.submittedAt), cbseQuestionKey(question), question.objectiveIds);
      total++; right += Number(isCorrect);
    }
    if (total) history.push({ id: session.sessionId, label: session.title || session.sourceFile || "Practice exam", at: time(session.submittedAt), answered: total, correct: right, cbse: session.blockId === CBSE_BLOCK_ID });
  }
  const seen = new Set();
  for (const [blockId, answers] of Object.entries(calibration)) for (const answer of Array.isArray(answers) ? answers : []) {
    const key = `${blockId}:${answer.ts}:${answer.concept}`;
    if (seen.has(key) || typeof answer.correct !== "boolean" || !answer.concept) continue;
    seen.add(key);
    record(`${blockId}:${normalize(answer.concept)}`, answer.concept, blockId, answer.lectureId || null, answer.correct, time(answer.ts), answer.questionKey || key, answer.objectiveIds);
  }
  const concepts = [...rows.values()].map(row => ({ ...row, accuracy: row.correct / row.answered })).sort((a,b) => a.accuracy - b.accuracy || b.answered - a.answered);
  const reports = Object.entries(weakConcepts).flatMap(([blockId, entries]) => (Array.isArray(entries) ? entries : []).map(entry => ({ ...entry, blockId }))).filter(entry => entry.masteryLevel !== "mastered").sort((a,b) => (b.reportGap || b.missCount || 0) - (a.reportGap || a.missCount || 0));
  const objectiveList = [...new Map(Object.values(objectives).flatMap(flattenObjectiveEntry).filter(o => o?.id).map(o => [o.id, o])).values()];
  return { answered, correct, accuracy: answered ? correct / answered : null, unlinked, concepts, reports, itemHistory,
    history: history.sort((a,b) => b.at - a.at), objectives: objectivePracticePlan(objectiveList, evidence).rows };
}
export function selectCbseQuestions(pool, progress, { count = 15, mode = "balanced", source = "all", random = Math.random } = {}) {
  const weakLectures = new Set(progress.reports.flatMap(row => row.linkedLecIds || []));
  const weakObjectives = new Set(progress.objectives.filter(row => row.state === "struggling").map(row => row.id));
  const eligible = pool.filter(q => source !== "examsoft" || /examsoft|esoft/i.test(`${q.sourceKind} ${q.sourceFile}`));
  const ranked = eligible.map(q => {
    const history = progress.itemHistory.get(cbseQuestionKey(q));
    const weak = history?.correct === false || weakLectures.has(q.lectureId) || q.objectiveIds?.some(id => weakObjectives.has(id));
    return { q, score: mode === "weak" ? Number(weak) * 10 + Number(!history) : mode === "unseen" ? Number(!history) * 10 : Number(weak) * 2 + Number(!history) * 2, tie: random() };
  }).filter(item => mode !== "unseen" || !progress.itemHistory.has(cbseQuestionKey(item.q)))
    .filter(item => mode !== "weak" || item.score >= 10).sort((a,b) => b.score-a.score || a.tie-b.tie);
  if (ranked.length < count) return { error: `Only ${ranked.length} eligible questions match these settings. Choose a smaller count or widen the practice focus.`, questions: [] };
  // Round-robin across original blocks within the ranked groups for a mixed exam.
  const selected = [], queues = new Map();
  for (const { q } of ranked) { const key=q.sourceBlockId || "unassigned"; if (!queues.has(key)) queues.set(key,[]); queues.get(key).push(q); }
  while (selected.length < count) for (const queue of queues.values()) { if (queue.length && selected.length < count) selected.push(queue.shift()); }
  return { questions: selected };
}
