/**
 * Turn an uploaded exam-report-style file (a category score table — "my score"
 * vs "class average" vs "correct" per topic) into weak-concept entries, so a
 * bad category surfaces in Weak Concepts and points straight back at the
 * lecture to restudy.
 *
 * Separate from `src/weakConcepts.js`'s `recordWrongAnswer` (per-question,
 * fired from DeepLearn) — this is per-category, fired once per exam-report
 * upload, and the two are expected to coexist in the same store.
 */

const CATEGORY_ROW_RE = /(\d{1,3}(?:\.\d{1,2})?)%\s+(\d{1,3}(?:\.\d{1,2})?)%\s+(\d+)\s*\/\s*(\d+)/g;

/** Cheap heuristic: is this text a score-table report, not a plain exam key? */
/** School goal used when a report has no class average to compare against. */
export const REPORT_TARGET_PERCENT = 80;
const NO_AVERAGE_ROW_RE = /\d{1,3}(?:\.\d{1,2})?%\s+\d+\s*\/\s*\d+/g;

export function looksLikeExamReport(text) {
  const t = String(text || "");
  const rows = t.match(CATEGORY_ROW_RE) || [];
  if (rows.length >= 3 && /average/i.test(t)) return true;
  // NB main-exam reports list only My Score and correct/total per category.
  return /Strengths and Improvement Opportunities/i.test(t) && (t.match(NO_AVERAGE_ROW_RE) || []).length >= 3;
}

/** Deterministic overall result used by the practice-to-school comparison. */
export function parseExamReportSummary(text, { blockId } = {}) {
  const source = String(text || "");
  if (!blockId || !/\bMy Score\b/i.test(source)) return null;
  if (!/\bAverage Score\b/i.test(source) && !/Strengths and Improvement Opportunities/i.test(source)) return null;
  const percent = Number(source.match(/(\d{1,3}(?:\.\d+)?)%\s+My Score/i)?.[1]);
  const dateParts = source.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  // The report name follows the heading on its own line (pdftotext) or, in
  // pdf.js text without line breaks, runs up to "Course:".
  const name = (source.match(/Strengths and Improvement Opportunities\s*\n\s*([^\n]+)/i)?.[1]
    || source.match(/Strengths and Improvement Opportunities\s+(.+?)\s+Course:/i)?.[1])?.trim();
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !dateParts || !name) return null;
  const date = `${dateParts[3]}-${dateParts[1].padStart(2, "0")}-${dateParts[2].padStart(2, "0")}`;
  const kind = /quiz/i.test(name) ? "quiz" : "exam";
  const id = encodeURIComponent(`${blockId}:${kind}:${date}:${name.toLowerCase()}`);
  const fraction = source.match(/My Score\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)/i);
  return { id, blockId, name, date, kind, percent, ...(fraction ? { correct: Number(fraction[1]), total: Number(fraction[2]) } : {}), source: "uploaded ExamSoft report" };
}

export function buildCategoryScorePrompt(text) {
  return (
    "This is a student's exam performance report. It lists categories/topics with the student's score, usually the class " +
    "average, and correct/total questions for that category — often three numbers together like " +
    '"20.00%  46.04%  2/10" near a category name label. Main-exam reports may show only the student score and ' +
    'correct/total (e.g. "54.55%  12/22"); then return "average":null for every row. Never invent an average.\n' +
    "Extract ONLY the actual studyable topic/subject rows. Skip generic umbrella rows that are just containers, not " +
    "topics — e.g. \"SCHOOL OF MEDICINE\", \"BASIC SCIENCES\", \"CONTENT OUTLINE / SYSTEMS\", \"DISCIPLINES\", " +
    "\"PHYSICIAN TASKS / COMPETENCIES\", a bare course code, or a numbered code row (e.g. \"13.2.08 Traumatic and " +
    "mechanical disorders\") when a plainer human-readable topic name already covers the same row (e.g. prefer " +
    '"Nutrition and aging" over its numeric code).\n' +
    "Return ONLY valid JSON:\n" +
    '{"categories":[{"category":"Nutrition and aging","myScore":0,"average":39.49,"correct":0,"total":2},{"category":"Cerebrovascular disease","myScore":54.55,"average":null,"correct":12,"total":22}]}\n\n' +
    "TEXT:\n" +
    String(text || "").slice(0, 12000)
  );
}

/** Validate + shape the AI's category rows. Drops anything not numerically sane. */
export function normalizeCategoryScores(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.categories) ? raw.categories : [];
  const out = [];
  const seen = new Set();
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const category = String(c.category || "").trim();
    if (!category) continue;
    const key = category.toLowerCase();
    if (seen.has(key)) continue;
    const myScore = Number(c.myScore);
    const average = c.average == null || c.average === "" ? null : Number(c.average);
    const total = Number(c.total);
    const correctRaw = Number(c.correct);
    if (!Number.isFinite(myScore) || (average !== null && !Number.isFinite(average)) || !Number.isFinite(total) || total <= 0) continue;
    seen.add(key);
    out.push({ category, myScore, average, correct: Number.isFinite(correctRaw) ? correctRaw : 0, total });
  }
  return out;
}

/** Meaningfully below class average; without an average, below the 80% goal
 * on at least three questions (one or two items are too little evidence). */
export function isWeakCategory(c, { gapThreshold = 10, targetPercent = REPORT_TARGET_PERCENT } = {}) {
  if (!c || !(c.total > 0)) return false;
  if (Number.isFinite(c.average)) return c.average - c.myScore >= gapThreshold;
  return c.total >= 3 && c.myScore < targetPercent;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "and", "or", "for", "with", "by", "is", "are", "quiz",
]);

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function overlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const bSet = new Set(bTokens);
  let hits = 0;
  for (const t of aTokens) if (bSet.has(t)) hits++;
  return hits / Math.sqrt(aTokens.length * bTokens.length);
}

/**
 * Best-matching candidate for a short phrase against a list, by word overlap.
 * Generic on purpose — a category name vs lecture titles, a task's deck path
 * vs lecture titles, an atom's term vs study-guide topics all reduce to the
 * same "fuzzy match this short label against a list of longer labels" shape.
 */
export function matchTextToCandidates(query, candidates, getText, threshold = 0.3) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return null;
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates || []) {
    const score = overlapScore(queryTokens, tokenize(getText(candidate) || ""));
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= threshold ? { item: best, score: bestScore } : null;
}

/** Best-matching lecture for a category name, by title word overlap. */
export function matchCategoryToLecture(category, lectures, threshold = 0.3) {
  const match = matchTextToCandidates(
    category,
    lectures,
    (lec) => lec?.lectureTitle || lec?.fileName || lec?.subject || "",
    threshold
  );
  return match ? { lecture: match.item, score: match.score } : null;
}

/** Conservatively map a report category to the best objective(s) in its matched lecture. */
export function matchCategoryToObjectives(category, objectives = [], lectures = [], lectureMatch = null, threshold = 0.36) {
  const candidates = lectureMatch?.lecture?.id
    ? objectives.filter((objective) => objective?.linkedLecId === lectureMatch.lecture.id || objective?.lectureId === lectureMatch.lecture.id)
    : objectives;
  const matches = candidates.map((objective) => {
    const objectiveText = [objective?.objective, objective?.text, objective?.content, objective?.code].filter(Boolean).join(" ");
    const lecture = lectures.find((item) => item?.id && item.id === (objective?.linkedLecId || objective?.lectureId));
    const match = matchTextToCandidates(category, [objective], () => `${objectiveText} ${lecture?.lectureTitle || lecture?.fileName || ""}`, threshold);
    return match ? { objective, score: match.score } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (!matches.length) return [];
  const best = matches[0].score;
  return matches.filter((match) => match.score >= threshold && best - match.score <= 0.08).slice(0, 3).map(({ objective, score }) => ({
    id: objective.id || objective.code,
    label: objective.objective || objective.text || objective.content || objective.code || objective.id,
    score: Math.round(score * 100) / 100,
  }));
}

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Weak-concept records, shaped exactly like `src/weakConcepts.js`'s records
 * (see `src/shell/features/tracker/weakConcepts.js`'s documented shape) so the
 * existing Weak Concepts view and ranking need no changes to read these.
 *
 * `id` is deterministic (blockId + category), not random — re-uploading a
 * later exam in the same category REPLACES the entry (see
 * `mergeExamReportConcepts`) rather than accumulating a duplicate, since a
 * new exam-report score supersedes the old one instead of adding to a miss count.
 */
export function buildWeakConceptEntriesFromReport({
  categories = [],
  lectures = [],
  objectives = [],
  blockId,
  blockName = "",
  now = new Date().toISOString(),
  gapThreshold = 10,
  matchThreshold = 0.3,
  report = null,
} = {}) {
  const entries = [];
  // Two reports in one block (an ESoft quiz and the NB main exam) score the
  // same outline categories; the report name keeps their entries apart.
  const reportSlug = report?.name ? `${slug(report.name)}-` : "";
  for (const c of categories) {
    if (!isWeakCategory(c, { gapThreshold })) continue;
    const match = matchCategoryToLecture(c.category, lectures, matchThreshold);
    const objectiveMatches = matchCategoryToObjectives(c.category, objectives, lectures, match);
    entries.push({
      id: `examcat-${blockId}-${reportSlug}${slug(c.category)}`,
      concept: c.category,
      description: Number.isFinite(c.average)
        ? `Exam report: scored ${Math.round(c.myScore)}% vs class average ${Math.round(c.average)}% (${c.correct}/${c.total} correct).`
        : `Exam report: scored ${Math.round(c.myScore)}% (${c.correct}/${c.total} correct), below the ${REPORT_TARGET_PERCENT}% goal.`,
      angle: "general",
      blockId,
      blockName,
      linkedLecIds: match ? [match.lecture.id].filter(Boolean) : [],
      lectureLabels: match ? [match.lecture.lectureTitle || match.lecture.fileName || c.category].filter(Boolean) : [],
      objectiveIds: objectiveMatches.map((item) => item.id).filter(Boolean),
      objectiveLabels: objectiveMatches.map((item) => item.label),
      objectiveMapping: objectiveMatches.length ? "candidate-category-overlap" : null,
      objectiveMappingScores: objectiveMatches.map(({ id, score }) => ({ id, score })),
      missCount: Math.max(c.total - c.correct, 1),
      reportScore: c.myScore,
      reportClassAverage: Number.isFinite(c.average) ? c.average : null,
      reportSampleSize: c.total,
      reportGap: Math.max(0, (Number.isFinite(c.average) ? c.average : REPORT_TARGET_PERCENT) - c.myScore),
      lastMissed: now,
      lastCorrect: null,
      consecutiveCorrect: 0,
      totalAttempts: c.total,
      masteryLevel: "struggling",
      questionHistory: [],
      sourceQuestions: [],
      dateFirstSeen: now,
      ...(report?.name ? { reportName: report.name, reportDate: report.date, reportKind: report.kind } : {}),
      tags: ["exam-report"],
    });
  }
  return entries;
}

/**
 * Replace this block's prior exam-report-derived entries with the new set
 * (by id), leaving every other concept (e.g. from recordWrongAnswer) alone.
 * A plain merge-keep-higher-missCount (like the store's generic `merge`)
 * would make an improved re-take look permanently as bad as the first one.
 */
export function mergeExamReportConcepts(existing, newEntries) {
  const newIds = new Set((newEntries || []).map((e) => e.id));
  const kept = (existing || []).filter((c) => !newIds.has(c?.id));
  return [...kept, ...(newEntries || [])];
}

/** Full pipeline: raw report text + this block's lectures -> weak-concept entries. */
export async function analyzeExamReportWeakConcepts(
  { text, lectures = [], objectives = [], blockId, blockName = "", now, gapThreshold, matchThreshold, report = null } = {},
  deps = {}
) {
  const { callAIJSON } = deps;
  if (!looksLikeExamReport(text)) return { entries: [], categories: [], skipped: true };
  try {
    const raw = await callAIJSON(
      "You extract category-level exam score tables from student performance reports. Return ONLY JSON.",
      buildCategoryScorePrompt(text),
      { categories: [] },
      3000
    );
    const categories = normalizeCategoryScores(raw);
    const entries = buildWeakConceptEntriesFromReport({ categories, lectures, objectives, blockId, blockName, now, gapThreshold, matchThreshold, report });
    return { entries, categories, skipped: false };
  } catch (e) {
    return { entries: [], categories: [], error: e?.message || String(e), skipped: false };
  }
}
