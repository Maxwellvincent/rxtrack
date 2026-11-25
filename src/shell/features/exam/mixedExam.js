import { prepareBankQuestionSet } from "./questionBankLinks.js";

/**
 * A block-wide mixed exam: distinct keyed school questions from every bank in
 * the block (clicker examples and held-out banks excluded), spread across
 * lectures and shuffled. `random` is injectable for tests.
 */
export function selectMixedExamQuestions(banks = [], { count = 40, isReserved = () => false, random = Math.random } = {}) {
  const seen = new Set();
  const byLecture = new Map();
  for (const bank of banks) {
    if (bank.sourceKind === "clicker") continue;
    for (const question of prepareBankQuestionSet(bank.questions || [], bank.analysis).questions) {
      if (!question?.stem || !question.correct || isReserved({ ...question, sourceFile: bank.filename })) continue;
      const key = String(question.stem).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      const lecture = question.lectureId || "unlinked";
      if (!byLecture.has(lecture)) byLecture.set(lecture, []);
      byLecture.get(lecture).push({ ...question, sourceFile: question.sourceFile || bank.filename });
    }
  }
  const shuffle = (list) => { const out = [...list]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; };
  // Round-robin across lectures so no single lecture dominates, then shuffle the order.
  const queues = shuffle([...byLecture.values()].map(shuffle));
  const picked = [];
  while (picked.length < count && queues.some((queue) => queue.length)) {
    for (const queue of queues) if (queue.length && picked.length < count) picked.push(queue.shift());
  }
  return { questions: shuffle(picked), available: seen.size, lectures: byLecture.size };
}
