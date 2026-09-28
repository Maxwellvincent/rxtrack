import { areNearDuplicateQuestions } from "../../../engine/questionSimilarity.js";

const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Extract explicit course/lecture labels from the uploaded question itself. */
export function sourceLectureClue(question = {}) {
  const text = `${question.stem || ""} ${question.explanation || ""}`;
  const match = text.match(/\b(?:lecture|lec)\s*(\d+)\s*[:.\-–—]\s*([^.!?\n]{3,120})/i);
  if (!match) return null;
  return { number: Number(match[1]), title: match[2].replace(/\s+/g, " ").trim(), label: `Lecture ${Number(match[1])}: ${match[2].replace(/\s+/g, " ").trim()}` };
}

function analysisItemFor(question, index, items = []) {
  const id = String(question?.id ?? question?.num ?? index + 1);
  return items.find((item) => String(item?.id) === id || String(item?.num) === id) || items[index] || null;
}

function attachCurriculumHints(question, item, index) {
  const clue = sourceLectureClue(question);
  const explicitTitle = normalize(clue?.title);
  const links = item?.lectureLinks || [];
  const titleMatches = explicitTitle
    ? links.filter((link) => {
        const candidate = normalize(link?.label);
        return candidate && (candidate.includes(explicitTitle) || explicitTitle.includes(candidate));
      })
    : [];
  return {
    ...question,
    ...(clue ? { sourceLectureClue: clue.label, sourceLectureNumber: clue.number } : {}),
    // These are review hints, not verified curriculum links or objective evidence.
    candidateLectureLinks: titleMatches.length ? titleMatches : links,
    candidateObjectiveLinks: item?.objectiveLinks || [],
    candidateLinkBasis: item?.objectiveBasis || (links.length ? "lecture-content-overlap" : null),
    sourceKeyReviewStatus: item?.correctnessStatus || null,
    sourceKeyCritique: Array.isArray(item?.critique) ? item.critique[0] : item?.critique || null,
    sourceQuestionNumber: question?.num ?? index + 1,
  };
}

/**
 * Build a safe practice set: remove near-identical imported items and attach
 * analysis/source-label hints without promoting guesses to verified links.
 */
export function prepareBankQuestionSet(questions = [], analysis = null) {
  const unique = [];
  for (const question of questions) {
    const stemSize = normalize(question?.stem).length;
    // Very short stems often repeat intentionally (e.g. a numbered recall
    // bank with shared choices), so only deduplicate sufficiently informative
    // clinical/source stems.
    const likelyDuplicate = stemSize >= 90 && unique.some((other) =>
      normalize(other?.stem).length >= 90 && areNearDuplicateQuestions(question, other, 0.92)
    );
    if (!likelyDuplicate) unique.push(question);
  }
  const items = analysis?.items || [];
  const prepared = unique.map((question) => {
    const originalIndex = questions.indexOf(question);
    return attachCurriculumHints(question, analysisItemFor(question, originalIndex, items), originalIndex);
  });
  return { questions: prepared, removedDuplicateCount: questions.length - unique.length };
}

export function scoreAnsweredQuestions(session) {
  const questions = new Map((session?.questions || []).map((question) => [question.questionId, question]));
  const answers = session?.answers || [];
  const valid = answers.filter((answer) => questions.has(answer.questionId) && answer.value != null);
  const correct = valid.filter((answer) => questions.get(answer.questionId)?.correct === answer.value).length;
  return { answered: valid.length, correct, incorrect: valid.length - correct, accuracy: valid.length ? Math.round(correct / valid.length * 100) : null };
}
