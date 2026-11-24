// Learning from the learner's own question-to-lecture assignments. Only links
// the learner made ("user-assigned" lecture, "user-confirmed" objectives) are
// learned from; automatic links never teach the system.

const MANUAL_BASIS = "user-assigned";

/** Normalized homework section heading ("Dissociative Disorders", "NB 58 …"). */
export function headingKey(question = {}) {
  const raw = String(question.sourceSectionTitle || question.sourceSection || "");
  return raw.normalize("NFKC").toLowerCase()
    .replace(/^\s*(?:nb|lec|lecture|dla)\s*\d+[a-z]?\b[\s.:-]*/i, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

/** Heading → lecture, learned only where every learner assignment agrees. */
export function learnedHeadingMap(questions = []) {
  const seen = new Map();
  for (const question of questions) {
    if (question?.lectureLinkBasis !== MANUAL_BASIS || !question.lectureId) continue;
    const key = headingKey(question);
    if (!key) continue;
    const row = seen.get(key) || { lectureIds: new Map(), lectureLabel: question.lectureLabel };
    row.lectureIds.set(question.lectureId, (row.lectureIds.get(question.lectureId) || 0) + 1);
    if (!row.lectureLabel) row.lectureLabel = question.lectureLabel;
    seen.set(key, row);
  }
  const map = new Map();
  for (const [key, row] of seen) {
    if (row.lectureIds.size !== 1) continue;
    const [[lectureId, count]] = [...row.lectureIds];
    map.set(key, { lectureId, lectureLabel: row.lectureLabel, count });
  }
  return map;
}

const isLinked = question => ["user-confirmed", "evidence-verified", "user-lecture-only"].includes(question?.curriculumLinkStatus)
  || question?.lectureLinkBasis === MANUAL_BASIS || question?.lectureLinkBasis === "learned-heading";

/** Pin unlinked questions whose heading the learner has already taught. No objective credit. */
export function applyLearnedHeadings(questions = [], map = new Map()) {
  let applied = 0;
  const next = questions.map(question => {
    if (!question?.stem || isLinked(question)) return question;
    const learned = map.get(headingKey(question));
    if (!learned) return question;
    applied += 1;
    return { ...question, lectureId: learned.lectureId, lectureLabel: learned.lectureLabel, lectureLinkBasis: "learned-heading",
      curriculumLinkStatus: "user-lecture-only", objectiveIds: [], curriculumLinkConfirmedAt: Date.now() };
  });
  return { questions: next, applied };
}

const STOP = new Set("a an the of and or to in on for with which what is are was were this that these following most likely patient man woman year old comes physician because history shows".split(" "));
const tokens = text => new Set(String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(word => word.length > 2 && !STOP.has(word)));

/** The learner's most similar objective-confirmed questions (hints, never evidence). */
export function similarPrecedents(question = {}, confirmed = [], limit = 3) {
  const target = tokens(`${question.stem} ${question.choices?.[question.correct] || ""}`);
  const heading = headingKey(question);
  return confirmed
    .filter(item => item?.curriculumLinkStatus === "user-confirmed" && item.lectureId && item.objectiveIds?.length && item !== question && item.stem !== question.stem)
    .map(item => {
      const words = tokens(`${item.stem} ${item.choices?.[item.correct] || ""}`);
      const shared = [...target].filter(word => words.has(word)).length;
      const sameHeading = !!heading && headingKey(item) === heading;
      return { item, sameHeading, score: shared / Math.max(1, Math.sqrt(target.size * words.size)) + (sameHeading ? 0.5 : 0), shared };
    })
    .filter(row => row.shared >= 2 || row.sameHeading)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, sameHeading }) => ({ stem: String(item.stem).slice(0, 300), lectureId: item.lectureId, lectureLabel: item.lectureLabel || null, objectiveIds: item.objectiveIds.slice(0, 2), sameHeading }));
}
