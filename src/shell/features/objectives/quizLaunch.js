/**
 * SP1 T1.3 — the objective-quiz launch contract for the shell.
 *
 * ObjectiveTracker calls `onStartObjectiveQuiz(objectives, lectureTitle,
 * blockId, meta)`. In App.jsx that ran a 400-line inline generator; here the
 * decisions are a pure config builder (testable) and the effectful part is one
 * call to the shared MCQ engine.
 *
 * Ported from App's `startObjectiveQuiz`: weakest-objective-first ordering, the
 * same question-count rules, the same lecture match by title fragment, and the
 * school exam bank as few-shot style exemplars.
 */
import { generateFromAtoms, generateMcqs } from "../../../engine/mcq.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../../stores/questionBankMeta.js";
import { getLecText } from "../../../lectureText.js";
import { selectAtomsForQuiz } from "../lectures/lectureStudy.js";
import * as atomProgressStore from "../../../stores/atomProgress.js";
import { canonicalObjectiveIds } from "../../../engine/objectiveLinks.js";
import { matchByTerm } from "../../../engine/tagAtoms.js";

/** Weakest first — fewest consecutive correct answers get quizzed first. */
export function sortWeakestFirst(objectives) {
  return [...(objectives || [])].sort(
    (a, b) => (a?.consecutiveCorrect || 0) - (b?.consecutiveCorrect || 0)
  );
}

/**
 * Ramp difficulty up as you demonstrate mastery, instead of a static default
 * you have to remember to raise yourself. Cumulative lecture-quiz accuracy
 * (lectureQuestionStats) is the signal — quieter than one quiz's score, and
 * already tracked with no new plumbing needed.
 */
export function resolveDefaultDifficulty(accuracy) {
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy)) return "medium";
  if (accuracy >= 0.9) return "expert";
  if (accuracy >= 0.8) return "hard";
  return "medium";
}

/** App's rule: "all" → everything, unset → up to 10, a number → at least 1. */
export function resolveQuestionCount(requested, available) {
  if (requested === "all") return available;
  if (requested == null) return Math.min(10, available);
  return Math.max(1, Number(requested) || 1);
}

/** Lecture whose title contains the first 20 chars of the quiz title, in this block. */
export function findLectureForQuiz(lectures, blockId, lectureTitle) {
  const needle = (lectureTitle || "").slice(0, 20).toLowerCase();
  if (!needle) return null;
  return (
    (lectures || []).find(
      (l) =>
        l?.blockId === blockId &&
        (l.lectureTitle || l.fileName || l.filename || "").toLowerCase().includes(needle)
    ) || null
  );
}

/**
 * Uploaded exam-bank questions used as style exemplars.
 *
 * Firestore-backed since the banks stopped being mirrored to localStorage —
 * 51 files was 618KB of a ~5MB budget. Signed out, the store falls back to
 * whatever local copy is left.
 */
export function readExemplars(userId = null) {
  try {
    const banks = questionBanksStore.read(userId) || {};
    return Object.values(banks).flat().filter((q) => q && q.stem && q.choices);
  } catch {
    return [];
  }
}

/** Pure block selection used by both synchronous readers and hydrated React consumers. */
export function selectExemplarsForBlock(banks = {}, meta = {}, blockId = null) {
  const eligible = (q) => q && q.stem && q.choices && q.sourceKind !== "supplemental";
  const all = Object.values(banks || {}).flat().filter(eligible);
  const filenames = Object.values(meta || {})
    .filter((entry) => entry && entry.blockId === blockId && entry.sourceKind !== "supplemental")
    .map((entry) => entry.filename);
  const scoped = filenames
    .flatMap((filename) => banks?.[filename] || [])
    .filter(eligible);
  if (!blockId) return all;
  return scoped.length ? scoped : all.filter(q => q.blockId === blockId);
}

/**
 * Spread a lecture quiz across its objectives before filling spare slots.
 * Atoms are evidence for an objective, not the quiz's organizing principle.
 */
export function selectAtomsByObjectiveCoverage(atoms = [], objectives = [], progress = {}, count = 10) {
  const limit = Math.max(0, Number(count) || 0);
  if (!limit) return [];
  const orderedIds = (objectives || []).map((o) => o?.id).filter(Boolean);
  if (!orderedIds.length) return selectAtomsForQuiz(atoms, progress, limit);

  const used = new Set();
  const groups = orderedIds.map((objectiveId) => ({
    objectiveId,
    atoms: selectAtomsForQuiz(
      atoms.filter((atom) => atom?.objectiveIds?.includes(objectiveId)),
      progress,
      atoms.length
    ),
  }));
  const selected = [];
  let advanced = true;
  while (selected.length < limit && advanced) {
    advanced = false;
    for (const group of groups) {
      const next = group.atoms.find((atom) => !used.has(atom));
      if (!next) continue;
      used.add(next);
      selected.push(next);
      advanced = true;
      if (selected.length >= limit) break;
    }
  }
  if (selected.length < limit) {
    const remainder = selectAtomsForQuiz(atoms.filter((atom) => !used.has(atom)), progress, limit - selected.length);
    selected.push(...remainder);
  }
  return selected;
}

/**
 * Block-scoped exemplars — same shape and filtering as `readExemplars`, but
 * limited to banks uploaded for `blockId` (via `questionBankMeta`) instead of
 * flattening every stored bank across every block.
 *
 * Falls back to the full unfiltered `readExemplars` result when nothing has
 * been uploaded for this block — a documented fallback, not a hard failure,
 * so quiz generation still gets style exemplars from whatever exists.
 */
export function readExemplarsForBlock(userId = null, blockId = null) {
  try {
    const meta = questionBankMetaStore.read(userId) || {};
    const banks = questionBanksStore.read(userId) || {};
    return selectExemplarsForBlock(banks, meta, blockId);
  } catch {
    return readExemplars(userId);
  }
}

/**
 * Everything the generator needs, decided without touching the network.
 * Returns `{ error }` instead of a config when there is nothing to quiz.
 */
export function buildQuizConfig({
  objectives,
  lectureTitle,
  blockId,
  lectures = [],
  exemplars = [],
  atoms = [],
  avoidStems = [],
  difficulty = "medium",
  questionCount,
  studyMode = "balanced",
}) {
  const pool = sortWeakestFirst(objectives);
  const count = resolveQuestionCount(questionCount, Math.max(pool.length, 1));

  // When no objectives, fall through to atom/text-based generation
  const selected = pool.slice(0, Math.min(count, pool.length));
  const lecture = findLectureForQuiz(lectures, blockId, lectureTitle);
  const lectureText = lecture ? getLecText(lecture) : "";

  if (!selected.length && !atoms.length && !lectureText.trim()) {
    return { error: "No objectives, lecture facts, or lecture text are available to quiz." };
  }

  return {
    config: {
      subject: lectureTitle || "these objectives",
      objectives: selected,
      atoms,
      lectureText,
      examples: exemplars,
      avoidStems,
      difficulty,
      count,
      studyMode,
    },
    lectureId: lecture?.id ?? selected.map((o) => o?.linkedLecId).find(Boolean) ?? null,
  };
}

/** The lecture-text floor `generateMcqs` enforces before it will generate. */
const MIN_LECTURE_TEXT = 150;

/** Objectives as quizzable facts — the fallback when no lecture text exists. */
export function objectivesAsAtoms(objectives) {
  return (objectives || [])
    .map((o) => ({
      type: "objective",
      term: o?.code || o?.id || "objective",
      content: o?.objective || o?.text || "",
      objectiveIds: o?.id ? [o.id] : [],
    }))
    .filter((a) => a.content);
}

function normalizedFallbackFact(atom, index) {
  const term = String(atom?.term || "").trim();
  const content = String(atom?.content || "").trim();
  if (!content) return null;
  return {
    term: term && term !== "objective" ? term : `Lecture concept ${index + 1}`,
    content,
    atomKey: term && term !== "objective" ? term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : null,
    objectiveIds: Array.isArray(atom?.objectiveIds) ? atom.objectiveIds.filter(Boolean).slice(0, 1) : [],
  };
}

/**
 * Credit-independent safety net assembled only from uploaded lecture facts/objectives.
 * These are honest foundational recognition items, not claimed as ExamSoft-style questions.
 */
export function buildGroundedRecallQuestions({ atoms = [], objectives = [], count = 10, avoidStems = [] } = {}) {
  const source = [...atoms, ...objectivesAsAtoms(objectives)].map(normalizedFallbackFact).filter(Boolean);
  const exactUnique = source.filter((fact, index) => source.findIndex((candidate) =>
    candidate.term.toLowerCase() === fact.term.toLowerCase() && candidate.content.toLowerCase() === fact.content.toLowerCase()
  ) === index);
  // Use a different concept before returning to another fact with the same term.
  // Dense lecture extraction can produce several supporting facts for one concept;
  // keeping them adjacent made a 10-item fallback feel like the same question repeated.
  const firstByConcept = [];
  const remainingByConcept = [];
  const seenConcepts = new Set();
  for (const fact of exactUnique) {
    const concept = fact.atomKey || fact.term.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenConcepts.has(concept)) remainingByConcept.push(fact);
    else {
      seenConcepts.add(concept);
      firstByConcept.push(fact);
    }
  }
  const unique = [...firstByConcept, ...remainingByConcept];
  if (!unique.length) return [];

  const avoided = new Set((avoidStems || []).map((stem) => String(stem).trim().toLowerCase().replace(/\s+/g, " ")));
  const questions = [];
  const clueFor = (fact) => {
    const escaped = fact.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const withoutAnswer = fact.content.replace(new RegExp(`^${escaped}\\s*(?::|[-–—]|\\bis\\b|\\bare\\b)?\\s*`, "i"), "").trim();
    return (withoutAnswer || fact.content).replace(/[.?!]+$/, "");
  };
  const variants = [
    { descriptionMode: true, stem: (fact) => `The following finding is observed: ${clueFor(fact)}. Which diagnosis or concept best explains it?` },
    { descriptionMode: false, stem: (fact) => `Which statement most accurately describes ${fact.term}?` },
    { descriptionMode: true, stem: (fact) => `Which concept is most directly associated with this finding: ${clueFor(fact)}?` },
    { descriptionMode: false, stem: (fact) => `Which relationship involving ${fact.term} is most accurate?` },
    { descriptionMode: false, stem: (fact) => `Which statement about ${fact.term} is correct?` },
  ];
  // Examine every fact/wording combination. The previous calculation could inspect only five
  // candidates when a lecture had many facts, so one avoided stem was enough to leave a 10-item
  // request stuck at 9/10 even though dozens of grounded combinations remained available.
  const maxPasses = unique.length * variants.length;
  for (let pass = 0; questions.length < count && pass < maxPasses; pass += 1) {
    const fact = unique[pass % unique.length];
    const variantIndex = Math.floor(pass / unique.length) % variants.length;
    const stem = variants[variantIndex].stem(fact);
    const key = stem.toLowerCase().replace(/\s+/g, " ");
    if (avoided.has(key)) continue;
    const descriptionMode = variants[variantIndex].descriptionMode;
    const distractors = unique
      .filter((candidate) => candidate !== fact)
      .map((candidate) => descriptionMode ? candidate.term : candidate.content)
      .filter((value, index, list) => value && list.indexOf(value) === index)
      .slice(0, 4);
    if (!distractors.length) distractors.push("No supported relationship is stated in the uploaded lecture.");
    const values = [descriptionMode ? fact.term : fact.content, ...distractors];
    const letters = ["A", "B", "C", "D", "E"];
    const rotation = pass % values.length;
    const rotated = [...values.slice(rotation), ...values.slice(0, rotation)];
    questions.push({
      stem,
      choices: Object.fromEntries(rotated.map((value, index) => [letters[index], value])),
      correct: letters[(values.length - rotation) % values.length],
      explanation: `${fact.term}: ${fact.content}`,
      whyWrong: {},
      topic: fact.term,
      atomKey: fact.atomKey,
      objectiveIds: fact.objectiveIds,
      taskType: "grounded-recall",
      difficulty: "foundational",
      generationMode: "grounded-fallback",
      qualityAudit: { version: 1, status: "source-grounded", checks: ["lecture-source-only"] },
    });
    avoided.add(key);
  }
  return questions.slice(0, count);
}

/**
 * Build the config, then generate. `deps.callAIJSON` is the AI transport, so a
 * test drives the whole path without a network call.
 *
 * Three tiers, in order of preference:
 *  1. Real lecture atoms exist — draw `count` of them via `selectAtomsForQuiz` (not-yet-complete
 *     first, per that lecture's atomProgress) and generate one question per atom, same posture
 *     Study's rounds use. Every question comes back with an exact `atomKey`, so answering it
 *     counts toward that atom's mastery — this is what makes Quiz and Study the same underlying
 *     system instead of two that happen to look similar.
 *  2. No atoms, but lecture text or objectives exist — the old free-form generator, ungrounded in
 *     any specific atom (its questions get no atomKey, so they inform objective-level calibration
 *     only, not atom mastery).
 *  3. Nothing at all except objectives — the objectives themselves become the facts to test, one
 *     question each, rather than failing the launch outright.
 */
export async function startObjectiveQuiz(args, deps = {}) {
  const atoms = Array.isArray(args.atoms) ? args.atoms : [];
  const built = buildQuizConfig(args);
  // Only error out if no objectives AND no atoms AND no lecture text hint
  if (built.error && !atoms.length) return { error: built.error, questions: [] };

  const { config, lectureId } = built;

  if (atoms.length) {
    const progress = lectureId ? atomProgressStore.progressForLecture(args.userId ?? null, lectureId) : {};
    const linked = atoms.map(a => ({ ...a, objectiveIds: canonicalObjectiveIds([...(a.objectiveIds || []), ...matchByTerm(a, config.objectives)], config.objectives) }));
    const selected = selectAtomsByObjectiveCoverage(linked, config.objectives, progress, config.count);
    // A sparse extraction must not silently shrink a requested lecture quiz. Fill the
    // remaining slots directly from distinct school objectives: atoms provide supporting
    // facts, while objectives remain the curriculum contract and primary quiz blueprint.
    if (selected.length < config.count) {
      const representedObjectives = new Set(selected.flatMap((atom) => atom.objectiveIds || []));
      const objectiveFacts = objectivesAsAtoms(config.objectives)
        .filter((atom) => !atom.objectiveIds.some((id) => representedObjectives.has(id)));
      selected.push(...objectiveFacts.slice(0, config.count - selected.length));
    }
    const result = await generateFromAtoms(
      { atoms: selected, objectives: config.objectives, subject: config.subject, difficulty: config.difficulty, examples: config.examples, avoidStems: config.avoidStems, studyMode: config.studyMode },
      deps
    );
    return { ...result, lectureId };
  }

  const hasText = String(config?.lectureText || "").trim().length >= MIN_LECTURE_TEXT;
  const hasObjectives = (config?.objectives || []).length > 0;

  if (hasText) {
    const result = await generateMcqs({ ...config, atoms }, deps);
    return { ...result, lectureId };
  }

  // Objective documents are valid source material on their own. Route them through the
  // fact-targeted generator; generateMcqs enforces a lecture-text floor and used to reject this
  // supposedly-supported path before the model was ever called.
  if (!hasObjectives) return { error: "No quiz source material is available.", questions: [], lectureId };
  return {
    ...(await generateFromAtoms(
      {
        atoms: objectivesAsAtoms(config?.objectives || []),
        objectives: config.objectives,
        difficulty: config?.difficulty,
        examples: config?.examples,
        avoidStems: config?.avoidStems,
        subject: config?.subject,
      },
      deps
    )),
    lectureId,
  };
}

/**
 * Prepare the complete question set the learner requested. Quality review is allowed to reject
 * weak items, but that must never silently turn a 10-question quiz into a one-question quiz.
 * Refill only the missing slots and carry accepted stems forward so retries stay fresh.
 */
export async function prepareObjectiveQuiz(args, deps = {}, onProgress = () => {}) {
  const requested = resolveQuestionCount(args.questionCount, Math.max((args.objectives || []).length, 1));
  const accepted = [];
  const seen = new Set();
  // Two reviewed AI passes strike the useful balance here: retain school-style generation, then
  // fill remaining slots instantly from uploaded lecture facts instead of making the learner wait
  // through several more provider/reviewer round trips.
  const attempts = Math.max(1, Number(deps.maxPrepareAttempts) || 2);
  let lastError = "";

  onProgress({ requested, ready: 0, attempt: 0, phase: "generating" });
  for (let attempt = 1; attempt <= attempts && accepted.length < requested; attempt += 1) {
    const remaining = requested - accepted.length;
    // Replacement rounds intentionally ask for a few spare candidates. One larger refill is
    // materially faster than several generator -> reviewer round trips when the reviewer is
    // rejecting a high share of the batch; only the requested number can ever be accepted.
    const batchCount = attempt === 1 ? remaining : Math.min(15, remaining + Math.ceil(remaining / 2));
    onProgress({ requested, ready: accepted.length, attempt, phase: attempt === 1 ? "generating" : "refilling" });
    const result = await startObjectiveQuiz(
      {
        ...args,
        questionCount: batchCount,
        avoidStems: [...(args.avoidStems || []), ...accepted.map((question) => question.stem)],
      },
      deps
    );
    lastError = result.error || lastError;
    const newlyAccepted = [];
    for (const question of result.questions || []) {
      const key = String(question?.stem || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      accepted.push(question);
      newlyAccepted.push(question);
      if (accepted.length >= requested) break;
    }
    if (newlyAccepted.length) deps.onAccepted?.(newlyAccepted);
    onProgress({ requested, ready: accepted.length, attempt, phase: accepted.length >= requested ? "ready" : "reviewing" });
    // A fully rejected batch is a quality outcome, not a provider failure: use the remaining
    // attempts to generate fresh candidates. Transport, quota, and reviewer availability errors
    // cannot improve inside this preparation run, so stop those immediately.
    const qualityOnlyRejection = /quality review rejected the generated batch/i.test(result.error || "");
    if (!result.questions?.length && result.error && !qualityOnlyRejection) break;
  }

  if (accepted.length < requested) {
    const grounded = buildGroundedRecallQuestions({
      atoms: args.atoms,
      objectives: args.objectives,
      count: requested - accepted.length,
      avoidStems: [...(args.avoidStems || []), ...accepted.map((question) => question.stem)],
    });
    accepted.push(...grounded);
    if (grounded.length) deps.onAccepted?.(grounded);
    onProgress({ requested, ready: accepted.length, attempt: attempts, phase: accepted.length >= requested ? "ready" : "fallback" });
  }
  if (accepted.length < requested) {
    const usablePartial = accepted.length >= Math.min(requested, Math.max(3, Math.ceil(requested * 0.6)));
    return {
      ...(usablePartial
        ? { warning: `Starting with ${accepted.length} verified questions. ${requested - accepted.length} unavailable slots were omitted.` }
        : { error: `Only ${accepted.length}/${requested} questions could be prepared. ${lastError || "Retry to generate the remaining questions."}` }),
      questions: accepted,
      incomplete: true,
      requested,
    };
  }
  return {
    questions: accepted.slice(0, requested),
    requested,
    incomplete: false,
    fallbackCount: accepted.filter((question) => question.generationMode === "grounded-fallback").length,
  };
}
