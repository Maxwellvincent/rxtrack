import { alignSchoolQuestions } from "../../engine/schoolAlignment.js";

const FOCUS_RULES = [
  ["genetics / inheritance", /inherit|autosomal|x-linked|dominant|recessive|pedigree|family history|consanguin|mutation|chromosome|allele/i],
  ["pharmacology / treatment", /drug|medication|inhibitor|agonist|antagonist|therapy|treat|dose|receptor|toxic/i],
  ["laboratory / data interpretation", /laboratory|lab\b|serum|plasma|urine|concentration|level|blood gas|value|graph|table|increase|decrease/i],
  ["anatomy / structure", /anatom|histolog|micrograph|tissue|nerve|artery|vein|muscle|bone|epithel|organ/i],
  ["mechanism / physiology", /mechanism|pathway|regulat|signal|transport|gradient|pressure|flow|why does|how does|result of/i],
  ["pathology / diagnosis", /diagnos|disease|syndrome|patholog|lesion|tumor|infection|inflammation|defect/i],
];

const CUE_RULES = [
  ["clinical presentation", /\b(?:year-old|month-old|patient|presents|chief complaint|history of|symptoms?)\b/i],
  ["family / inheritance clue", /family history|parent|sibling|offspring|pedigree|consanguin/i],
  ["laboratory clue", /serum|plasma|urine|blood gas|laboratory|concentration|level|value/i],
  ["anatomic or image clue", /figure|image|micrograph|histolog|biopsy|cross-section|lesion/i],
  ["mechanism lead-in", /mechanism|how does|why does|which process|regulate|transport/i],
  ["decision lead-in", /most likely|best explains|would be expected|which finding|next step/i],
];

const words = (value) => new Set((String(value || "").toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []));
const textOfObjective = (objective) => objective?.objective || objective?.text || objective?.content || "";

export function sourceLabel(sourceKind = "school", filename = "") {
  if (sourceKind === "homework" || sourceKind === "supplemental" || /homework|worksheet|practice question/i.test(filename)) return "Homework / supplemental";
  return "Official school / ExamSoft";
}

export function classifyQuestionFocus(question = {}) {
  const text = `${question.topic || ""} ${question.stem || ""} ${question.explanation || ""}`;
  const focus = FOCUS_RULES.find(([, pattern]) => pattern.test(text))?.[0] || (question.type === "clinicalVignette" ? "clinical application" : "foundational recognition");
  const cues = CUE_RULES.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const clinical = cues.includes("clinical presentation") || cues.includes("decision lead-in") || cues.includes("laboratory clue") || cues.includes("anatomic or image clue");
  return { focus, cues, clinical, recognitionSignal: /buzzword|classic|characteristic|associated with|most likely/i.test(text) };
}

function candidateObjectiveLinks(question, objectives) {
  const qWords = words(`${question.stem || ""} ${question.topic || ""} ${question.explanation || ""}`);
  return objectives.map((objective) => {
    const objectiveWords = words(textOfObjective(objective));
    const shared = [...objectiveWords].filter((word) => qWords.has(word));
    return { objective, shared, score: shared.length };
  }).filter((item) => item.score >= 2).sort((a, b) => b.score - a.score).slice(0, 2);
}

function lectureSupport(question, lectures = [], linkedObjectives = []) {
  const target = words(`${question.stem || ""} ${question.topic || ""} ${question.explanation || ""}`);
  return lectures.map((lecture) => {
    const map = lecture?.teachingMap || {};
    const atoms = Array.isArray(lecture?.atoms) ? lecture.atoms : [];
    const body = [lecture.lectureTitle, map.summary, map.clinicalHook, ...(map.sections || []).flatMap((section) => [section.title, section.clinicalRelevance]), ...atoms.flatMap((atom) => [atom.term, atom.content, ...(atom.buzzwords || []), ...(atom.clinicalCues || [])])].join(" ");
    const shared = [...words(body)].filter((word) => target.has(word));
    const objectiveHit = linkedObjectives.some(({ objective }) => objective.linkedLecId === lecture.id || objective.lectureId === lecture.id);
    return { lecture, shared, score: shared.length + (objectiveHit ? 4 : 0), map };
  }).filter((item) => item.score >= 3).sort((a, b) => b.score - a.score).slice(0, 2);
}

export function buildQuestionBankAnalysis({ questions = [], objectives = [], lectures = [], sourceKind = "school", filename = "", expectedQuestions = null, extractionMethod = null } = {}) {
  const list = Array.isArray(questions) ? questions : [];
  const keyed = list.filter((question) => question?.sourceKeyStatus === "present" || (question?.correct && question?.choices?.[question.correct])).length;
  const alignments = alignSchoolQuestions(list, objectives, lectures.flatMap((lecture) => lecture?.atoms || []));
  const byQuestion = new Map(alignments.map((entry) => [entry.question.id || entry.question.num, entry]));
  const items = list.map((question, index) => {
    const focus = classifyQuestionFocus(question);
    const direct = byQuestion.get(question.id || question.num);
    const directObjectiveLinks = direct?.links?.filter((link) => link.kind === "objective").slice(0, 2) || [];
    const candidateObjectives = directObjectiveLinks.length ? directObjectiveLinks : candidateObjectiveLinks(question, objectives).map(({ objective, shared }) => ({ targetId: objective.id || objective.code, targetText: textOfObjective(objective), basis: "candidate-overlap", evidence: shared.slice(0, 6), score: shared.length }));
    const objectiveIds = candidateObjectives.map((link) => link.targetId).filter(Boolean).slice(0, 2);
    const supports = lectureSupport(question, lectures, candidateObjectives.map((link) => ({ objective: objectives.find((item) => (item.id || item.code) === link.targetId) })).filter((item) => item.objective));
    const critique = [];
    if (!question?.sourceKeyStatus || question.sourceKeyStatus === "missing") critique.push("The uploaded source did not provide a verifiable answer key for this item.");
    if (!question?.explanation) critique.push("No source rationale was imported; use the lecture evidence before trusting the keyed answer.");
    if (!focus.clinical) critique.push("The stem has no clear patient, data, image, or decision cue; classify it as foundational recognition before comparing it with ExamSoft style.");
    if (!objectiveIds.length) critique.push("No supported lecture objective match was found yet.");
    return {
      id: question.id || `q${index + 1}`,
      num: question.num || index + 1,
      focus: focus.focus,
      clinical: focus.clinical,
      clinicalCues: focus.cues,
      objectiveIds,
      objectiveBasis: candidateObjectives[0]?.basis || "unmapped",
      lectureIds: supports.map(({ lecture }) => lecture.id).filter(Boolean),
      clinicalCorrelates: supports.flatMap(({ map }) => [map.clinicalHook, ...(map.sections || []).map((section) => section.clinicalRelevance)]).filter(Boolean).slice(0, 3),
      sourcePage: question.sourcePage || null,
      sourceKeyStatus: question.sourceKeyStatus || (question.correct && question.choices?.[question.correct] ? "present" : "missing"),
      correctnessStatus: question.correct && question.choices?.[question.correct] ? "source-key-present-not-medically-audited" : "needs-review",
      critique: critique.length ? critique : ["Source key is present. Compare the rationale and lecture support before treating this as medically confirmed."],
    };
  });
  const focusCounts = {};
  const cueCounts = {};
  for (const item of items) {
    focusCounts[item.focus] = (focusCounts[item.focus] || 0) + 1;
    for (const cue of item.clinicalCues) cueCounts[cue] = (cueCounts[cue] || 0) + 1;
  }
  return {
    version: 1,
    status: "ready",
    sourceLabel: sourceLabel(sourceKind, filename),
    sourceKind,
    filename,
    questionCount: list.length,
    keyedCount: keyed,
    expectedQuestions: expectedQuestions ?? null,
    complete: expectedQuestions == null || (list.length >= expectedQuestions && keyed >= expectedQuestions),
    extractionMethod: extractionMethod || null,
    focusCounts,
    cueCounts,
    objectiveCount: items.filter((item) => item.objectiveIds.length).length,
    clinicalQuestionCount: items.filter((item) => item.clinical).length,
    items,
    updatedAt: Date.now(),
  };
}

export function buildQuestionBankCritiquePrompt(analysis, questions, objectives = [], lectures = []) {
  const source = (questions || []).slice(0, 60).map((question, index) => `${index + 1}. [${question.id || `q${index + 1}`}] ${question.stem}\nChoices: ${Object.entries(question.choices || {}).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join(" | ")}\nKey: ${question.correct || "missing"}\nSource explanation: ${question.explanation || "missing"}`).join("\n\n");
  const curriculum = (objectives || []).slice(0, 80).map((objective) => `[${objective.id || objective.code || "objective"}] ${textOfObjective(objective)}`).join("\n");
  const lectureText = (lectures || []).slice(0, 30).map((lecture) => `${lecture.id}: ${lecture.lectureTitle}\n${lecture.teachingMap?.summary || ""}\nClinical hook: ${lecture.teachingMap?.clinicalHook || ""}`).join("\n\n");
  return `Review uploaded school or homework questions against the supplied curriculum. Never change the source answer key. Mark correctness as source-key-present-not-medically-audited unless the lecture evidence supports a concern, then use needs-review. Separate direct lecture support from candidate word overlap. Identify what each item is testing, its clinical cues/buzzwords, the matching objective and lecture, and one actionable critique. Do not import outside facts as if taught.\n\nCURRENT DETERMINISTIC ANALYSIS:\n${JSON.stringify(analysis)}\n\nOBJECTIVES:\n${curriculum || "none"}\n\nLECTURE MAPS:\n${lectureText || "none"}\n\nQUESTIONS:\n${source}\n\nReturn JSON only: {"items":[{"id":"q1","focus":"...","clinicalCues":["..."],"buzzwords":["..."],"objectiveIds":["exact supplied id"],"lectureIds":["exact supplied id"],"clinicalCorrelates":["..."],"correctnessStatus":"source-key-confirmed|source-key-present-not-medically-audited|needs-review|unsupported-by-lecture","critique":"..."}]}`;
}

export function mergeQuestionBankCritique(analysis, reviewed) {
  if (!analysis || !Array.isArray(reviewed?.items)) return analysis;
  const byId = new Map(reviewed.items.map((item) => [String(item.id), item]));
  return {
    ...analysis,
    status: "reviewed",
    items: analysis.items.map((item) => {
      const review = byId.get(String(item.id));
      if (!review) return item;
      return { ...item, ...review, objectiveIds: Array.isArray(review.objectiveIds) ? review.objectiveIds : item.objectiveIds, lectureIds: Array.isArray(review.lectureIds) ? review.lectureIds : item.lectureIds, clinicalCues: Array.isArray(review.clinicalCues) ? review.clinicalCues : item.clinicalCues, buzzwords: Array.isArray(review.buzzwords) ? review.buzzwords : [] };
    }),
    updatedAt: Date.now(),
  };
}
