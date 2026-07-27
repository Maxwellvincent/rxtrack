/**
 * SP1 T6.1 — the AI question context, extracted from App.
 *
 * DeepLearn (and App's exam/quiz paths) feed this to the generator: the most
 * relevant uploaded exam questions as style exemplars, the lecture text, the
 * objectives in scope, and a style summary. Ported 1:1, with the App closures
 * (lectures, objectives, style prefs) taken as arguments instead.
 */
import { getLecText } from "../../lectureText.js";

const MAX_LECTURE_CHARS = 6000;
const SAMPLE_TARGET = 8;
const PER_FILE_CAP = 3;

const OCR_NOTE =
  "The following lecture content has been extracted with high-fidelity OCR, preserving tables, headings, and document structure as markdown. Use the structure to identify high-yield topics.\n\n";

/** Flatten the question banks, tagging each question with the file it came from. */
export function flattenQuestionBanks(banks) {
  return Object.entries(banks || {}).flatMap(([sourceFile, questions]) =>
    (questions || []).map((q) => ({ ...q, sourceFile }))
  );
}

/**
 * Relevance of one uploaded question to a lecture. Everything is ranked rather
 * than filtered — the old behaviour dropped whole files whose name did not
 * match, which silently excluded most uploads from informing generation.
 */
export function scoreQuestionForLecture(question, lecture) {
  if (!lecture) return 0;
  const titleLow = (lecture.lectureTitle || "").toLowerCase().slice(0, 30);
  const numStr = String(lecture.lectureNumber || "").trim();
  const fname = (question.sourceFile || "").toLowerCase();
  const topic = (question.topic || question.subject || "").toLowerCase();
  const stem = (question.stem || "").toLowerCase();

  let score = 0;
  if (titleLow && (topic.includes(titleLow) || stem.includes(titleLow))) score += 5;
  if (titleLow && fname.includes(titleLow.slice(0, 10))) score += 3;
  // A 1-char number would match anything ("2" inside "MADCOW_CPR2").
  if (numStr.length >= 2 && fname.includes(numStr)) score += 2;
  if (titleLow) {
    for (const kw of titleLow.split(/\W+/).filter((w) => w.length >= 5)) {
      if (topic.includes(kw)) score += 1;
      if (stem.includes(kw)) score += 0.5;
    }
  }
  return score;
}

/** Up to 8 exemplars, no more than 3 from any one file, so the style varies. */
export function pickSample(ranked) {
  const picked = [];
  const perFile = new Map();
  for (const q of ranked) {
    if (picked.length >= SAMPLE_TARGET) break;
    const file = q.sourceFile || "";
    const count = perFile.get(file) || 0;
    if (count >= PER_FILE_CAP) continue;
    picked.push(q);
    perFile.set(file, count + 1);
  }
  // The cap can leave us short; backfill in score order.
  if (picked.length < SAMPLE_TARGET) {
    for (const q of ranked) {
      if (picked.length >= SAMPLE_TARGET) break;
      if (!picked.includes(q)) picked.push(q);
    }
  }
  return picked;
}

export function styleAnalysisFor(questions) {
  if (!questions.length) return null;
  return {
    avgStemLength: Math.round(
      questions.reduce((a, q) => a + (q.stem || "").length, 0) / questions.length
    ),
    hasClinicalCases: questions.filter((q) => /year.old|presents|patient/i.test(q.stem || "")).length,
    hasCalculations: questions.filter((q) => /calculate|how many|what is the dose/i.test(q.stem || "")).length,
    hasMechanisms: questions.filter((q) => /mechanism|pathway|why|how does/i.test(q.stem || "")).length,
    sourceFiles: [...new Set(questions.map((q) => q.sourceFile))],
    totalQuestions: questions.length,
  };
}

/**
 * @param {object} args
 * @param {string|null} args.lectureId    lecture in focus, or null for the block
 * @param {object[]} args.lectures        every lecture (ids are looked up here)
 * @param {object[]} args.objectives      the block's objectives, already deduped
 * @param {object} args.questionBanks     rxt-question-banks
 * @param {string[]} [args.selectedLecIds] several lectures, for exam mode
 */
export function buildQuestionContext({
  lectureId = null,
  lectures = [],
  objectives = [],
  questionBanks = {},
  selectedLecIds = null,
  stylePrefs = {},
}) {
  const lecture = lectureId ? lectures.find((l) => l.id === lectureId) : null;

  const ranked = flattenQuestionBanks(questionBanks)
    .map((q) => ({ q, score: scoreQuestionForLecture(q, lecture) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.q);

  const ids = selectedLecIds?.length ? selectedLecIds : lectureId ? [lectureId] : [];
  const used = ids.map((id) => lectures.find((l) => l.id === id)).filter(Boolean);
  const anyOcr = used.some((l) => l.extractionMethod === "mistral-ocr");
  let lectureChunks = used.map((l) => getLecText(l)).join("\n").slice(0, MAX_LECTURE_CHARS);
  if (lectureChunks) lectureChunks = (anyOcr ? OCR_NOTE : "") + lectureChunks;

  const inScope = (objectives || []).filter(
    (o) =>
      !lectureId ||
      o.linkedLecId === lectureId ||
      (lecture && (lecture.mergedFrom || []).some((m) => m && m.id === o.linkedLecId))
  );

  return {
    relevantQs: pickSample(ranked),
    lectureChunks,
    objectives: inScope.slice(0, 20),
    styleAnalysis: styleAnalysisFor(ranked),
    hasLectureContent: (lectureChunks || "").trim().length > 0,
    hasUploadedQs: ranked.length > 0,
    hasObjectives: inScope.length > 0,
    stylePrefs,
  };
}
