// Score report categories as study targets. An ExamSoft report scores broad
// NBME-outline categories ("Cerebrovascular disease", "Disorders of the eye")
// that span many lectures. One AI call per report block turns each category
// into search keywords plus the lectures that teach it; matching after that is
// deterministic: objectives in those lectures that mention a keyword, and
// school questions (homework, IMCQ, ESoft) linked to those lectures/objectives
// or whose stem names the topic. A category is "improved" once practice on its
// material after the report reaches 80% over at least 10 answers on 2+ days.

import { REPORT_TARGET_PERCENT } from "./examReportWeakConcepts.js";
import { bankFormat } from "./bankMappingScope.js";

export const REPORT_TARGET_VERSION = 1;
export const IMPROVED_ACCURACY = 0.8;
export const IMPROVED_MIN_ANSWERS = 10;
export const IMPROVED_MIN_DAYS = 2;

const norm = value => String(value || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();

/** Report-derived weak-concept entries, across blocks. */
export function reportEntries(weakConcepts = {}) {
  return Object.entries(weakConcepts || {}).flatMap(([blockId, entries]) =>
    (Array.isArray(entries) ? entries : []).filter(entry => entry?.tags?.includes("exam-report")).map(entry => ({ ...entry, blockId: entry.blockId || blockId })));
}

export function buildReportTargetPrompt(categories = [], lectures = []) {
  return (
    "These are category rows from a medical student's school exam score report, and the lectures of the block the exam covered.\n" +
    "For each category:\n" +
    '- "broad": true ONLY for a whole-exam skill, competency, discipline or whole organ-system label (e.g. "Patient Care: Diagnosis", ' +
    '"Medical Knowledge", "History/Physical Exam", "Prognosis/Outcome", "Neuroscience", "Histology & Cell Biology", "Nervous System & Special Senses", ' +
    '"Male Reproductive System", "Organ structure and function", "Social Sciences"). ' +
    "Any named disease group, disorder class or physiological topic is NOT broad, even when no listed lecture teaches it " +
    "(e.g. \"Sleep disorders\", \"Cranial nerve injury/disorders\", \"Immunologic and inflammatory disorders\", " +
    "\"Adaptive behavioral responses to stress\", \"Communication and interpersonal skills\" all get broad:false with keywords).\n" +
    '- "keywords": 4-12 lowercase terms a question or lecture on that topic would use (diseases, structures, signs, drugs), e.g. ' +
    'Cerebrovascular disease -> ["stroke","infarct","hemorrhage","aneurysm","middle cerebral artery","lacunar","transient ischemic attack"]. Empty for broad rows.\n' +
    '- "lectureIds": ids of the listed lectures that teach this topic (0-8). Use only ids from the list. Empty for broad rows.\n' +
    'Return ONLY JSON: {"targets":[{"category":"...","broad":false,"keywords":["..."],"lectureIds":["..."]}]}\n\n' +
    "CATEGORIES:\n" + categories.map(category => `- ${category}`).join("\n") + "\n\nLECTURES:\n" +
    lectures.map(lecture => `${lecture.id} | ${lecture.lectureTitle || lecture.title || lecture.fileName || ""}`).join("\n")
  );
}

/** Validate the AI rows; lecture ids must exist in the block. */
export function normalizeReportTargets(raw, lectures = []) {
  const known = new Set(lectures.map(lecture => lecture.id));
  const out = new Map();
  for (const row of Array.isArray(raw?.targets) ? raw.targets : []) {
    const category = String(row?.category || "").trim();
    if (!category) continue;
    const broad = row.broad === true;
    out.set(norm(category), {
      broad,
      keywords: broad ? [] : [...new Set((Array.isArray(row.keywords) ? row.keywords : []).map(norm).filter(word => word.length >= 3))].slice(0, 12),
      lectureIds: broad ? [] : [...new Set((Array.isArray(row.lectureIds) ? row.lectureIds : []).filter(id => known.has(id)))].slice(0, 8),
    });
  }
  return out;
}

/** Distinct keywords found in a text (whole-word match). */
export function keywordHits(text, keywords = []) {
  const haystack = ` ${norm(text)} `;
  return keywords.filter(keyword => haystack.includes(` ${keyword} `));
}

const lectureText = lecture => [lecture?.lectureTitle, lecture?.title,
  ...(lecture?.chunks || []).map(chunk => chunk?.text || chunk?.content || ""),
  ...(lecture?.atoms || []).map(atom => [atom?.term, atom?.fact, atom?.text].filter(Boolean).join(" "))].join(" ");

/**
 * Lectures and objectives for one category. AI-chosen lectures, plus any
 * block lecture whose text uses at least 3 distinct keywords (or names one in
 * its title); objectives in those lectures that mention a keyword.
 */
export function matchCategoryTarget({ keywords = [], lectureIds = [], broad = false }, { lectures = [], objectives = [] } = {}) {
  if (broad) return { lectureIds: [], objectiveIds: [] };
  const chosen = new Set(lectureIds);
  for (const lecture of lectures) {
    if (chosen.has(lecture.id) || !keywords.length) continue;
    if (keywordHits(lecture.lectureTitle || lecture.title, keywords).length || keywordHits(lectureText(lecture), keywords).length >= 3) chosen.add(lecture.id);
  }
  const objectiveIds = objectives
    .filter(objective => objective?.id && chosen.has(objective.linkedLecId || objective.lectureId)
      && keywordHits([objective.objective, objective.text, objective.content].filter(Boolean).join(" "), keywords).length)
    .map(objective => objective.id).slice(0, 25);
  return { lectureIds: [...chosen].slice(0, 12), objectiveIds };
}

/** Saved target fields for an entry; legacy fields mirror it for older readers. */
export function withReportTarget(entry, { broad, keywords, lectureIds, objectiveIds }, { lectures = [], now = new Date().toISOString(), report = null } = {}) {
  const title = id => lectures.find(lecture => lecture.id === id)?.lectureTitle || id;
  return {
    ...entry,
    reportTarget: { version: REPORT_TARGET_VERSION, broad: !!broad, keywords, lectureIds, objectiveIds, mappedAt: now },
    ...(report ? { reportName: report.name, reportDate: report.date, reportKind: report.kind } : {}),
    linkedLecIds: lectureIds,
    lectureLabels: lectureIds.map(title),
    objectiveIds,
    objectiveMapping: objectiveIds.length ? "report-target-keywords" : null,
  };
}

/** Whether a school or generated question belongs to a category. */
export function questionMatchesTarget(question, target) {
  if (!target || target.broad) return false;
  if (question?.lectureId && target.lectureIds?.includes(question.lectureId)) return true;
  if ((question?.secondaryLectureIds || []).some(id => target.lectureIds?.includes(id))) return true;
  if ((question?.objectiveIds || []).some(id => target.objectiveIds?.includes(id))) return true;
  const text = [question?.stem, question?.explanation, question?.topic, question?.concept].filter(Boolean).join(" ");
  return keywordHits(text, target.keywords || []).length >= 2;
}

/** School format of a pooled question, for "6 homework · 4 IMCQ · 3 ESoft". */
export function questionFormat(question) {
  if (question?.sourceKind === "generated") return "generated";
  const format = bankFormat(question?.sourceFile || "", question?.sourceKind || "");
  return format === "other" && /homework|practice|supplemental/i.test(question?.sourceFile || "") ? "homework" : format;
}

const reportTime = entry => new Date(entry?.reportDate || entry?.dateFirstSeen || 0).getTime() || 0;
const dayKey = at => new Date(at).toISOString().slice(0, 10);

/**
 * Practice on a category's material after its report: submitted sessions'
 * answered questions that match, plus calibration answers on its lectures or
 * objectives.
 */
export function targetPracticeSince(entry, { sessions = [], calibration = {} } = {}) {
  const target = entry?.reportTarget;
  const since = reportTime(entry);
  let answered = 0, correct = 0;
  const days = new Set(), seen = new Set();
  const add = (isCorrect, at, key) => {
    if (!(at > since) || seen.has(key)) return;
    seen.add(key); answered++; correct += Number(isCorrect); days.add(dayKey(at));
  };
  if (target && !target.broad) {
    for (const session of sessions || []) {
      if (session?.status !== "submitted") continue;
      const answers = new Map((session.answers || []).map(answer => [answer.questionId, answer]));
      for (const question of session.questions || []) {
        const answer = answers.get(question.questionId);
        if (!answer || !Object.hasOwn(question.choices || {}, answer.value) || !questionMatchesTarget(question, target)) continue;
        const at = new Date(answer.answeredAt || session.submittedAt || 0).getTime();
        add(answer.value === question.correct, at, `${session.sessionId || session.id}:${question.questionId}`);
      }
    }
    for (const answers of Object.values(calibration || {})) for (const answer of Array.isArray(answers) ? answers : []) {
      if (typeof answer?.correct !== "boolean") continue;
      if (!(target.lectureIds.includes(answer.lectureId) || (answer.objectiveIds || []).some(id => target.objectiveIds.includes(id)))) continue;
      add(answer.correct, new Date(answer.ts || 0).getTime(), `cal:${answer.ts}:${answer.questionKey || answer.concept}`);
    }
  }
  const accuracy = answered ? correct / answered : null;
  const improved = answered >= IMPROVED_MIN_ANSWERS && accuracy >= IMPROVED_ACCURACY && days.size >= IMPROVED_MIN_DAYS;
  return { answered, correct, accuracy, days: days.size, improved };
}

/** Bigger gap on more questions first. */
export function targetPriority(entry) {
  const gap = Number(entry?.reportGap) || Math.max(0, REPORT_TARGET_PERCENT - (Number(entry?.reportScore) || 0));
  return gap * Math.sqrt(Math.max(1, Number(entry?.reportSampleSize) || 1));
}

/**
 * Rows for the CBSE "Report targets" plan. `pool` is the CBSE school pool,
 * `generated` the generated questions; each row carries its matching
 * questions so "Practice this category" can launch them.
 */
export function reportTargetRows({ weakConcepts = {}, pool = [], generated = [], sessions = [], calibration = {} } = {}) {
  return reportEntries(weakConcepts).map(entry => {
    const target = entry.reportTarget || null;
    const school = target ? pool.filter(question => questionMatchesTarget(question, target)) : [];
    const made = target ? generated.filter(question => questionMatchesTarget(question, target)) : [];
    const formats = { homework: 0, imcq: 0, esoft: 0, other: 0 };
    for (const question of school) formats[questionFormat(question)] = (formats[questionFormat(question)] || 0) + 1;
    return { entry, target, mapped: !!target && target.version >= REPORT_TARGET_VERSION, broad: !!target?.broad, school, generated: made, formats,
      practice: targetPracticeSince(entry, { sessions, calibration }), priority: targetPriority(entry) };
  }).sort((a, b) => Number(a.practice.improved) - Number(b.practice.improved) || b.priority - a.priority);
}

/** Share of a category set drawn from generated questions when both kinds exist. */
export const GENERATED_SHARE = 0.4;

/**
 * Up to `count` questions for one category, school and generated mixed
 * (about 60/40, either kind filling in when the other runs short), missed and
 * unseen first within each kind, interleaved so neither kind clumps.
 */
export function categoryPracticeSet(row, { count = 20, itemHistory = new Map(), keyOf = question => question.questionId, random = Math.random } = {}) {
  const rank = question => { const history = itemHistory.get(keyOf(question)); return history?.correct === false ? 0 : history ? 2 : 1; };
  const order = list => (list || []).map(question => ({ question, rank: rank(question), tie: random() })).sort((a, b) => a.rank - b.rank || a.tie - b.tie).map(item => item.question);
  const school = order(row.school), made = order(row.generated);
  const madeTake = Math.min(made.length, Math.max(count - school.length, Math.round(count * GENERATED_SHARE)));
  const schoolTake = Math.min(school.length, count - madeTake);
  const out = [];
  let s = 0, g = 0;
  while (s < schoolTake || g < madeTake) {
    // Take from whichever kind is furthest behind its share.
    if (g >= madeTake || (s < schoolTake && s / schoolTake <= g / madeTake)) out.push(school[s++]);
    else out.push(made[g++]);
  }
  return out;
}
