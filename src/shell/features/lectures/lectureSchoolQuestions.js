// School questions (homework, IMCQ, ESoft) linked to one lecture, from every
// saved bank in any block: a CBSE-filed IMCQ that taught NB 3 still counts for
// its NB 3 lecture. A question counts for its primary lecture and for any
// verified second lecture of an integrated item.

import { bankFormat } from "../../logic/bankMappingScope.js";
import * as questionFigures from "../../../stores/questionFigures.js";
import { launchQuestionBankSession } from "../exam/launchQuestionBank.js";

export const SCHOOL_FORMAT_LABELS = { homework: "homework", imcq: "IMCQ", esoft: "ESoft", other: "other" };
const VERIFIED = new Set(["evidence-verified", "user-confirmed"]);

/** `{ [lectureId]: { counts: {homework, imcq, esoft, other}, total, verified, items: [{filename, question}] } }` */
export function schoolQuestionsByLecture(banks = {}, meta = {}) {
  const kindOf = {};
  for (const entry of Object.values(meta || {})) if (entry?.filename) kindOf[entry.filename] = entry.sourceKind || "";
  const out = {};
  for (const [filename, questions] of Object.entries(banks || {})) {
    if (!Array.isArray(questions)) continue;
    const format = bankFormat(filename, kindOf[filename]);
    for (const question of questions) {
      if (!question?.correct) continue;
      const lectures = [question.lectureId, ...(VERIFIED.has(question.curriculumLinkStatus) ? question.secondaryLectureIds || [] : [])].filter(Boolean);
      for (const lectureId of new Set(lectures)) {
        const row = out[lectureId] ||= { counts: { homework: 0, imcq: 0, esoft: 0, other: 0 }, total: 0, verified: 0, items: [] };
        row.counts[format] += 1;
        row.total += 1;
        if (VERIFIED.has(question.curriculumLinkStatus)) row.verified += 1;
        row.items.push({ filename, question });
      }
    }
  }
  return out;
}

/** "6 homework · 4 IMCQ · 3 ESoft", formats with questions only. */
export function schoolQuestionSummary(entry) {
  if (!entry?.total) return "";
  return ["homework", "imcq", "esoft", "other"].filter(format => entry.counts[format]).map(format => `${entry.counts[format]} ${SCHOOL_FORMAT_LABELS[format]}`).join(" · ");
}

/**
 * Start an untimed practice session from one lecture's school questions.
 * Figures are applied per source bank first, since a set mixes banks.
 */
export async function launchLectureSchoolQuestions({ userId, blockId, lecture, entry, lectures = [] }, deps = {}) {
  const loadFigures = deps.loadFigures || questionFigures.load;
  const byFile = new Map();
  for (const item of entry?.items || []) (byFile.get(item.filename) || byFile.set(item.filename, []).get(item.filename)).push(item.question);
  const questions = [];
  for (const [filename, list] of byFile) {
    const figures = await loadFigures(userId, filename).catch(() => ({}));
    questions.push(...list.map(question => ({ ...questionFigures.apply(question, figures), sourceFile: question.sourceFile || filename })));
  }
  const title = lecture?.lectureTitle || lecture?.title || "Lecture";
  return (deps.launch || launchQuestionBankSession)({
    userId, blockId, filename: `${title} · school questions`, questions, lectures, format: "practice",
  }, { loadFigures: async () => ({}), ...(deps.launchDeps || {}) });
}
