import { curriculumMappingProvenance } from '../../../engine/curriculumMappingContext.js';
import { automaticLectureContentMatch } from "../../logic/lectureContentMatch.js";
import { cleanSchoolQuestion } from "../../../engine/schoolSourceText.js";
import { cleanLectureTitle, formatLectureLabel } from "../../../lectureTitle.js";
import { areNearDuplicateQuestions } from "../../../engine/questionSimilarity.js";

const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Extract explicit course/lecture labels from the uploaded question itself. */
export function sourceLectureClue(question = {}) {
  const section = String(question.sourceSection || "").match(/^(?:NB|N|LEC|LECTURE)\s*0*(\d+)$/i);
  if (section && question.sourceSectionTitle) {
    return { number: Number(section[1]), title: question.sourceSectionTitle, label: `${question.sourceSection}: ${question.sourceSectionTitle}` };
  }
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
    sourceKeyReviewStatus: question.sourceKeyReviewStatus || item?.correctnessStatus || null,
    sourceKeyCritique: question.sourceKeyCritique || (Array.isArray(item?.critique) ? item.critique[0] : item?.critique || null),
    sourceQuestionNumber: question?.sourceQuestionNumber ?? question?.num ?? index + 1,
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
      !(question.sourceSection && other.sourceSection && (question.sourceSection !== other.sourceSection || question.sourceQuestionNumber !== other.sourceQuestionNumber)) &&
      normalize(other?.stem).length >= 90 && areNearDuplicateQuestions(question, other, 0.92)
    );
    if (!likelyDuplicate) unique.push(question);
  }
  const items = analysis?.items || [];
  const prepared = unique.map((question) => {
    const originalIndex = questions.indexOf(question);
    return attachCurriculumHints(cleanSchoolQuestion(question), analysisItemFor(question, originalIndex, items), originalIndex);
  });
  return { questions: prepared, removedDuplicateCount: questions.length - unique.length };
}

/** Persist curriculum links only after a learner confirms the reviewer proposal. */
export function confirmQuestionBankCurriculumLinks(question, analysisItem, { objectiveIds = [], lectureIds = [] } = {}) {
  const allowedObjectives = new Set(objectiveIds.map(String));
  const allowedLectures = new Set(lectureIds.map(String));
  const reviewedObjectives = analysisItem?.objectiveLinkReviewStatus === "ai-reviewed"
    ? [...new Set((analysisItem.objectiveIds || []).map(String).filter((id) => allowedObjectives.has(id)))].slice(0, 2)
    : [];
  const reviewedLectures = analysisItem?.objectiveLinkReviewStatus === "ai-reviewed"
    ? [...new Set((analysisItem.lectureIds || []).map(String).filter((id) => allowedLectures.has(id)))].slice(0, 1)
    : [];
  if (!reviewedObjectives.length) return null;
  return {
    ...question,
    objectiveIds: reviewedObjectives,
    ...(reviewedLectures.length === 1 ? { lectureId: reviewedLectures[0] } : {}),
    curriculumLinkStatus: "user-confirmed",
    curriculumLinkConfirmedAt: Date.now(),
  };
}

export function scoreAnsweredQuestions(session) {
  const questions = new Map((session?.questions || []).map((question) => [question.questionId, question]));
  const answers = session?.answers || [];
  const valid = answers.filter((answer) => questions.has(answer.questionId) && answer.value != null);
  const correct = valid.filter((answer) => questions.get(answer.questionId)?.correct === answer.value).length;
  return { answered: valid.length, correct, incorrect: valid.length - correct, accuracy: valid.length ? Math.round(correct / valid.length * 100) : null };
}

/** Exact source labels can establish lecture attribution, but never objective mastery. */
export function linkSourceLecture(question, lectures = [], blockId) {
  question = cleanSchoolQuestion(question);
  if (["user-confirmed", "evidence-verified"].includes(question.curriculumLinkStatus) && lectures.some(l => l.id === question.lectureId && (!l.blockId || l.blockId === blockId))) return question;
  const groupedNumbers = question.sourceLectureNumbers || (/^NB\s*\d+(?:\s*\/\s*NB\s*\d+)+$/i.test(question.sourceSection || '') ? [...question.sourceSection.matchAll(/\d+/g)].map(m=>Number(m[0])) : []);
  if (groupedNumbers.length > 1) {
    const candidates = lectures.filter(l => {
      if (l.blockId && l.blockId !== blockId || /^(?:DLA|SG|TBL)$/i.test(l.lectureType || '')) return false;
      const number = l.lectureNumber ?? String(l.lectureTitle || l.title || '').match(/^(?:NB|LEC|LECTURE)\s*0*(\d+)\b/i)?.[1];
      return groupedNumbers.includes(Number(number));
    });
    const match = automaticLectureContentMatch(question, candidates, blockId);
    if (!match) return {...question,candidateLectureLinks:candidates.map(l=>({id:l.id,label:formatLectureLabel(l)})),candidateLinkBasis:'explicit-source-lecture-group'};
    return {...question,lectureId:match.lecture.id,lectureLabel:formatLectureLabel(match.lecture),curriculumLinkStatus:'content-matched',lectureLinkBasis:'source-lecture-group-and-content',lectureLinkEvidence:match.titleEvidence,curriculumMapping:curriculumMappingProvenance(question,match.lecture,blockId,'source-lecture-group-and-content')};
  }
  const clue = sourceLectureClue(question);
  if (!clue) {
    const localLectures = lectures.filter(l => !l.blockId || l.blockId === blockId);
    const broadMatch = automaticLectureContentMatch(question, localLectures, blockId);
    // Rank the full block so a narrow schedule cannot hide contradictory content.
    const match = broadMatch;
    if (!match) return question;
    return { ...question, lectureId: match.lecture.id, lectureLabel: formatLectureLabel(match.lecture),
      curriculumLinkStatus: "content-matched", lectureLinkBasis: match.contextualEvidence?.length ? "teaching-context-and-content" : "distinctive-lecture-topic",
      lectureLinkEvidence: [...match.titleEvidence, ...(match.contextualEvidence || [])],
      curriculumMapping: curriculumMappingProvenance(question, match.lecture, blockId, match.contextualEvidence?.length ? "teaching-context-and-content" : "distinctive-lecture-topic"), candidateLectureLinks: [] };
  }
  const cleanTitle = value => normalize(cleanLectureTitle(value).replace(/&/g, " and ").replace(/^(?:lecture|lec|nb|n)\s*0*\d+\s*(?:[:.·–—-]\s*)?/i, "").replace(/^(?:nb|n)\s*0*\d+\s*/, ""));
  const expectedTitle = cleanTitle(clue.title);
  const candidates = lectures.filter(lecture => {
    if (lecture.blockId && lecture.blockId !== blockId) return false;
    if (/^(?:DLA|SG|TBL)$/i.test(lecture.lectureType || "")) return false;
    const title = cleanLectureTitle(lecture.lectureTitle || lecture.title || lecture.fileName);
    const prefix = title.match(/^(?:lecture|lec|nb|n)\s*0*(\d+)\b/i);
    const number = lecture.lectureNumber ?? (prefix ? Number(prefix[1]) : null);
    return Number(number) === clue.number && (!expectedTitle || cleanTitle(title) === expectedTitle);
  });
  if (candidates.length !== 1) return question;
  return { ...question, lectureId: candidates[0].id, lectureLabel: formatLectureLabel(candidates[0]), curriculumLinkStatus: "source-label-matched", lectureLinkBasis: "explicit-source-number-and-title", sourceLectureClue: clue.label, sourceLectureNumber: clue.number, curriculumMapping: curriculumMappingProvenance(question, candidates[0], blockId, "explicit-source-number-and-title") };
}

export function lectureReviewSummary(session, labels = {}) {
  const rows = new Map();
  const answers = new Map((session.answers || []).filter(a => a.value != null).map(a => [a.questionId, a]));
  for (const q of session.questions || []) {
    const answer = answers.get(q.questionId);
    if (!answer || !q.lectureId) continue;
    const row = rows.get(q.lectureId) || { lectureId: q.lectureId, label: labels[q.lectureId] || q.lectureLabel || q.lectureId, answered: 0, correct: 0, misses: 0 };
    row.answered++; if (answer.value === q.correct) row.correct++; else row.misses++;
    rows.set(q.lectureId, row);
  }
  return [...rows.values()].sort((a, b) => b.misses - a.misses || a.correct / a.answered - b.correct / b.answered);
}
