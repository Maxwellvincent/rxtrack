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
import { ATOM_QUIZ_CAP, generateFromAtoms, generateMcqs } from "../../../engine/mcq.js";
import * as questionBanksStore from "../../../stores/questionBanks.js";
import * as questionBankMetaStore from "../../../stores/questionBankMeta.js";
import * as questionBankAnalysisStore from "../../../stores/questionBankAnalysis.js";
import * as questionStyleProfileStore from "../../../stores/questionStyleProfile.js";
import { getLecText } from "../../../lectureText.js";
import { selectAtomsForQuiz } from "../lectures/lectureStudy.js";
import { areNearDuplicateQuestions, questionSimilarity } from "../../../engine/questionSimilarity.js";
import { buildClinicalCorrelateLibrary } from "../../../engine/clinicalCorrelates.js";
import { objectivesWithPracticeEvidence } from "../../../engine/objectivePractice.js";
import { read as readLearnerEvidence } from "../../../stores/learnerEvidence.js";
import { buildOrderBlueprint } from "../../../engine/questionOrder.js";
import { buildStyleProfile, STYLE_PROFILE_VERSION } from "../../../engine/styleProfile.js";

// Rich clinical stems plus five per-choice explanations are large JSON
// objects. Asking for ten in one response routinely truncates otherwise good
// batches. Five keeps each model/reviewer exchange reliable while the
// preparation loop still fills any requested quiz size and saves each accepted
// batch immediately.
export const PREPARE_BATCH_SIZE = 5;

/** Weakest first — repair, then consolidation, then first-pass coverage. */
export function sortWeakestFirst(objectives) {
  const rank = (objective) => {
    const status = String(objective?.status || "untested").toLowerCase();
    if (status === "struggling" || status === "needs_repair") return 0;
    if (status === "developing" || status === "inprogress" || status === "in_progress") return 1;
    if (status === "untested" || !status) return 2;
    if (status === "mastered" || status === "ready") return 3;
    return 1;
  };
  return [...(objectives || [])].sort((a, b) =>
    (Number(a?._focusPriority) || 0) - (Number(b?._focusPriority) || 0)
      || rank(a) - rank(b)
      || (a?.consecutiveCorrect || 0) - (b?.consecutiveCorrect || 0)
      || (Number(a?.attempts) || 0) - (Number(b?.attempts) || 0)
  );
}

function objectiveStatus(objective) {
  const status = String(objective?.status || "untested").toLowerCase();
  if (status === "struggling" || status === "needs_repair") return "struggling";
  if (status === "developing" || status === "inprogress" || status === "in_progress") return "developing";
  if (status === "mastered" || status === "ready") return "mastered";
  return "untested";
}

/**
 * A new quiz is intentionally concentrated, not evenly smeared over the lecture.
 * Roughly two thirds of available slots go to repair, then developing objectives;
 * untested/mastered objectives receive remaining coverage. A single objective is
 * capped before the plan cycles so one label cannot consume the whole quiz.
 */
export function buildAdaptiveObjectivePlan(objectives, questionCount) {
  const pool = objectives || [];
  const hasUnready = pool.some(objective => objectiveStatus(objective) !== "mastered");
  const ordered = sortWeakestFirst(hasUnready ? pool.filter(objective => objectiveStatus(objective) !== "mastered") : pool);
  const count = Math.max(1, Number(questionCount) || 1);
  const targets = new Map();
  const addRoundRobin = (items, slots, cap) => {
    let added = 0;
    for (let pass = 0; pass < cap && added < slots; pass += 1) {
      for (const objective of items) {
        if (added >= slots) break;
        const id = objective?.id || objective?.code;
        if (!id) continue;
        targets.set(id, (targets.get(id) || 0) + 1);
        added += 1;
      }
    }
    return added;
  };

  let remaining = count;
  const focused = ordered.filter((objective) => Number(objective?._focusPriority) === 0);
  if (focused.length) {
    const focusSlots = Math.min(remaining, Math.max(focused.length, Math.ceil(count * 0.6)), focused.length * 3);
    remaining -= addRoundRobin(focused, focusSlots, 3);
  }

  const notAlreadyFocused = (objective) => !focused.includes(objective);
  const struggling = ordered.filter((objective) => notAlreadyFocused(objective) && objectiveStatus(objective) === "struggling");
  if (remaining && struggling.length) {
    const repairSlots = focused.length
      ? remaining
      : Math.min(remaining, Math.max(struggling.length, Math.ceil(count * 0.67)), struggling.length * 3);
    remaining -= addRoundRobin(struggling, repairSlots, 3);
  }

  for (const [status, cap] of [["developing", 2], ["untested", 1], ["mastered", 1]]) {
    if (!remaining) break;
    const group = ordered.filter((objective) => notAlreadyFocused(objective) && objectiveStatus(objective) === status);
    remaining -= addRoundRobin(group, remaining, cap);
  }

  // If the requested quiz is larger than the first deliberate pass, cycle the
  // non-mastered plan again before spending extra questions on mastered work.
  const refill = ordered.filter((objective) => objectiveStatus(objective) !== "mastered");
  while (remaining > 0 && refill.length) {
    const added = addRoundRobin(refill, remaining, 1);
    if (!added) break;
    remaining -= added;
  }
  while (remaining > 0 && ordered.length) {
    const added = addRoundRobin(ordered, remaining, 1);
    if (!added) break;
    remaining -= added;
  }

  return ordered
    .map((objective) => {
      const id = objective?.id || objective?.code;
      const target = targets.get(id) || 0;
      return target ? { ...objective, _targetQuestionCount: target, _adaptiveStatus: objectiveStatus(objective) } : null;
    })
    .filter(Boolean);
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
 * Uploaded questions available as generation evidence. The MCQ engine separates
 * official style exemplars from Homework task-pattern evidence downstream.
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

/**
 * Return lifetime-wide school examples so every block benefits from the
 * uploaded ExamSoft and IMCQ writing patterns. Lecture facts and objectives
 * still control the content of the generated question.
 */
export function selectExemplarsForBlock(banks = {}, _meta = {}, _blockId = null) {
  const eligible = (q) => q && q.stem && q.choices;
  const metaByFilename = new Map(
    Object.values(_meta || {})
      .filter((entry) => entry?.filename)
      .map((entry) => [entry.filename, entry])
  );
  return Object.entries(banks || {}).flatMap(([filename, questions]) =>
    (Array.isArray(questions) ? questions : [])
      .filter(eligible)
      .map((question) => {
        const upload = metaByFilename.get(filename);
        // Older imported rows did not carry blockId on every question. Stamp it
        // from the upload metadata so clinical evidence can be scoped safely.
        return upload?.blockId && !question.blockId ? { ...question, blockId: upload.blockId } : question;
      })
  );
}

/**
 * Prior questions used as clinical-emphasis evidence must belong to the active
 * block. The full exemplar set remains curriculum-wide for style calibration.
 */
export function selectClinicalExamplesForBlock(examples = [], blockId = null) {
  if (!blockId) return examples || [];
  return (examples || []).filter((question) => question?.blockId === blockId);
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
 * Curriculum-wide exemplars, including ExamSoft and IMCQ uploads from earlier
 * blocks. The active lecture still supplies the factual scope.
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

/** Analyzed upload signals for the active block, including homework. */
export function readClinicalAnalysesForBlock(userId = null, blockId = null) {
  try {
    const meta = questionBankMetaStore.read(userId) || {};
    const entries = Object.values(meta).filter((entry) =>
      entry && entry.filename && (!blockId || entry.blockId === blockId)
    );
    return entries
      .map((entry) => {
        const analysis = questionBankAnalysisStore.read(userId, entry.filename);
        return analysis
          ? { ...analysis, sourceKind: analysis.sourceKind || entry.sourceKind, blockId: entry.blockId, filename: entry.filename }
          : null;
      })
      .filter((analysis) => analysis && Array.isArray(analysis.items));
  } catch {
    return [];
  }
}

/**
 * Everything the generator needs, decided without touching the network.
 * Returns `{ error }` instead of a config when there is nothing to quiz.
 */
export function buildQuizConfig({
  objectives,
  lectureTitle,
  lectureIdHint = null,
  blockId,
  lectures = [],
  exemplars = [],
  atoms = [],
  avoidStems = [],
  difficulty = "medium",
  questionCount,
  studyMode = "balanced",
  userId = null,
  clinicalCorrelateLibrary = null,
  styleProfile = null,
  focusNotes = "",
  evidenceModel = null,
  objectiveAllocation = null,
}) {
  const pool = sortWeakestFirst(objectivesWithPracticeEvidence(objectives, evidenceModel || readLearnerEvidence(userId)));
  const count = resolveQuestionCount(questionCount, Math.max(pool.length, 1));

  // When no objectives, fall through to atom/text-based generation
  const selected = objectiveAllocation || buildAdaptiveObjectivePlan(pool, count);
  const lecture = (lectureIdHint && (lectures || []).find((item) => item?.id === lectureIdHint))
    || (pool.map((objective) => objective?.linkedLecId).find(Boolean)
      ? (lectures || []).find((item) => item?.id === pool.map((objective) => objective?.linkedLecId).find(Boolean))
      : findLectureForQuiz(lectures, blockId, lectureTitle));
  const lectureText = lecture ? getLecText(lecture) : "";
  const recurringClinicalCorrelates = clinicalCorrelateLibrary || buildClinicalCorrelateLibrary({
    atoms,
    examples: selectClinicalExamplesForBlock(exemplars, blockId),
    analyses: readClinicalAnalysesForBlock(userId, blockId),
  });

  if (!selected.length && !atoms.length && !lectureText.trim()) {
    return { error: "No objectives, lecture facts, or lecture text are available to quiz." };
  }

  const storedStyleProfile = questionStyleProfileStore.read(userId);
  const currentStyleProfile = styleProfile || (storedStyleProfile?.version === STYLE_PROFILE_VERSION
    ? storedStyleProfile
    : buildStyleProfile(exemplars));

  return {
    config: {
      subject: lectureTitle || "these objectives",
      objectives: selected,
      atoms,
      lectureText,
      examples: exemplars,
      styleProfile: currentStyleProfile,
      avoidStems,
      difficulty,
      count,
      studyMode,
      clinicalCorrelateLibrary: recurringClinicalCorrelates,
      orderBlueprint: buildOrderBlueprint({ objectives: selected, count }),
      requireReasoningAudit: true,
      focusNotes: [
        String(focusNotes || "").trim(),
        selected.length
          ? `ADAPTIVE OBJECTIVE ALLOCATION — follow these item counts before broad coverage:\n${selected.map((objective) => `- [${objective.id || objective.code}] ${objective._adaptiveStatus}: ${objective._targetQuestionCount} question${objective._targetQuestionCount === 1 ? "" : "s"}; target ${objective._targetOrder || "second-order"}; ${objective._neededTaskTypes?.length ? `use a different task from ${objective._neededTaskTypes.join(", ")}` : "vary the final ask"}`).join("\n")}`
          : "",
      ].filter(Boolean).join("\n\n"),
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
 * Objectives are the quiz contract. Atoms are supporting lecture evidence only; they must never
 * determine which questions are selected or force one question per definition/mechanism. This
 * keeps objective comparison/prediction tasks visible even when extraction produced many atoms.
 */
export async function startObjectiveQuiz(args, deps = {}) {
  const atoms = Array.isArray(args.atoms) ? args.atoms : [];
  const built = buildQuizConfig(args);
  // Only error out if no objectives AND no atoms AND no lecture text hint
  if (built.error && !atoms.length) return { error: built.error, questions: [] };

  const { config, lectureId } = built;

  const hasText = String(config?.lectureText || "").trim().length >= MIN_LECTURE_TEXT;
  const hasObjectives = (config?.objectives || []).length > 0;

  // The objective-first generator receives all available atoms as evidence, but chooses
  // question targets from the objective list rather than iterating atom-by-atom.
  if (hasText || atoms.length || hasObjectives) {
    // Keep each request small and fast: atoms are retrieval evidence, not one-question-per-atom
    // targets. Preparation rotates this bounded evidence window across batches.
    const selectedIds = new Set(config.objectives.map(objective => objective.id || objective.code));
    const relevantAtoms = [...atoms.filter(atom => atom.objectiveIds?.some(id => selectedIds.has(id))), ...atoms.filter(atom => !atom.objectiveIds?.some(id => selectedIds.has(id)))];
    const evidenceAtoms = atoms.length
      ? relevantAtoms.slice(0, selectedIds.size ? Math.max(12, config.count * 4) : Math.max(1, config.count))
      : objectivesAsAtoms(config.objectives || []);
    const result = await generateMcqs({ ...config, atoms: evidenceAtoms, generationVersion: args.generationVersion }, deps);
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
        styleProfile: config?.styleProfile,
        avoidStems: config?.avoidStems,
        subject: config?.subject,
        generationVersion: args.generationVersion,
        clinicalCorrelateLibrary: config.clinicalCorrelateLibrary,
        orderBlueprint: config.orderBlueprint,
      },
      deps
    )),
    lectureId,
  };
}

export function remainingObjectiveAllocation(plan = [], answered = [], limit = 5) {
  const used = new Map();
  for (const question of answered) {
    const id = question.objectiveIds?.[0];
    if (id) used.set(id, (used.get(id) || 0) + 1);
  }
  const allocations = new Map();
  for (let pass = 0; pass < limit; pass += 1) {
    for (const objective of plan) {
      if ([...allocations.values()].reduce((sum, n) => sum + n, 0) >= limit) break;
      const id = objective.id || objective.code;
      const assigned = allocations.get(id) || 0;
      if ((used.get(id) || 0) + assigned < objective._targetQuestionCount) allocations.set(id, assigned + 1);
    }
  }
  return plan.filter(objective => allocations.has(objective.id || objective.code))
    .map(objective => ({ ...objective, _targetQuestionCount: allocations.get(objective.id || objective.code) }));
}

/**
 * Prepare the complete question set the learner requested. Quality review is allowed to reject
 * weak items, but that must never silently turn a 10-question quiz into a one-question quiz.
 * Refill only the missing slots and carry accepted stems forward so retries stay fresh.
 */
export async function prepareObjectiveQuiz(args, deps = {}, onProgress = () => {}) {
  const requested = resolveQuestionCount(args.questionCount, Math.max((args.objectives || []).length, 1));
  const plannedObjectives = objectivesWithPracticeEvidence(args.objectives || [], args.evidenceModel || readLearnerEvidence(args.userId));
  const allocationPlan = buildAdaptiveObjectivePlan(plannedObjectives, args.plannedCount || requested);
  const enforceAllocation = allocationPlan.length > 0 && args.generationVersion === "v2";
  const accepted = [];
  const seen = new Set();
  const normalizeStem = (stem) => String(stem || "").trim().toLowerCase().replace(/\s+/g, " ");
  const avoidedStemKeys = new Set((args.avoidStems || []).map(normalizeStem).filter(Boolean));
  const avoidedQuestions = Array.isArray(args.avoidQuestions) ? args.avoidQuestions.filter(Boolean) : [];
  // Bound generation retries. V2 reports a shortfall instead of substituting foundational recall.
  // Preparation actually requests PREPARE_BATCH_SIZE items at a time. Using the
  // larger engine cap here gave a 15-item quiz only three total attempts: just
  // enough to draft 15 candidates, with no refill capacity after review.
  const plannedBatches = Math.max(1, Math.ceil(requested / PREPARE_BATCH_SIZE));
  const attempts = Math.max(1, Number(deps.maxPrepareAttempts) || (plannedBatches + 1));
  let lastError = "";
  let consecutiveEmptyRounds = 0;
  const isProviderFailure = (message = "") => /provider\s+(?:unavailable|failure|error)|bridge|quota|rate limit|timed out|timeout|network|unavailable|not enough lecture|no quiz source|no quiz source material/i.test(String(message));

  onProgress({ requested, ready: 0, attempt: 0, phase: "generating" });
  for (let attempt = 1; attempt <= attempts && accepted.length < requested; attempt += 1) {
    const remaining = requested - accepted.length;
    // Replacement rounds intentionally ask for a few spare candidates. One larger refill is
    // materially faster than several generator -> reviewer round trips when the reviewer is
    // rejecting a high share of the batch; only the requested number can ever be accepted.
    // Ask for a full replacement batch even when only one or two slots remain. The spare
    // candidates are discarded after deduplication, but they prevent a repeated concept from
    // consuming the last requested slot and leaving a 21/25 quiz.
    const batchAllocation = remainingObjectiveAllocation(allocationPlan, [...(args.initialQuestions || []), ...accepted], Math.min(remaining, PREPARE_BATCH_SIZE));
    const batchCount = enforceAllocation
      ? batchAllocation.reduce((sum, objective) => sum + objective._targetQuestionCount, 0)
      : Math.min(PREPARE_BATCH_SIZE, ATOM_QUIZ_CAP, Math.max(remaining, PREPARE_BATCH_SIZE));
    if (!batchCount) break;
    const rotate = (items = []) => {
      if (!items.length) return items;
      const offset = ((attempt - 1) * PREPARE_BATCH_SIZE) % items.length;
      return [...items.slice(offset), ...items.slice(0, offset)];
    };
    onProgress({ requested, ready: accepted.length, attempt, phase: attempt === 1 ? "generating" : "refilling" });
    const result = await startObjectiveQuiz(
      {
        ...args,
        atoms: rotate(args.atoms || []),
        objectives: enforceAllocation ? batchAllocation : rotate(args.objectives || []),
        objectiveAllocation: enforceAllocation ? batchAllocation : null,
        questionCount: batchCount,
        avoidStems: [...(args.avoidStems || []), ...accepted.map((question) => question.stem)],
      },
      deps
    );
    lastError = result.error || lastError;
    const newlyAccepted = [];
    for (const question of result.questions || []) {
      const key = normalizeStem(question?.stem);
      if (enforceAllocation) {
        const target = remainingObjectiveAllocation(allocationPlan, [...(args.initialQuestions || []), ...accepted], requested).find(objective => question.objectiveIds?.[0] === (objective.id || objective.code));
        const levels = ["first-order", "second-order", "third-order"];
        if (!target || question.reasoningAudit?.status !== "verified" || levels.indexOf(question.orderLevel) < levels.indexOf(target._targetOrder || "second-order")) continue;
      }
      const repeatsPriorQuestion = avoidedQuestions.some((other) => questionSimilarity(question, other) >= 0.9);
      // Repeated practice of one topic/objective is valid: a quiz count is a hard
      // request. Reject duplicate or near-duplicate questions, not distinct tasks
      // solely because they share an atom/topic label.
      if (!key || seen.has(key) || avoidedStemKeys.has(key) || repeatsPriorQuestion || accepted.some((other) => areNearDuplicateQuestions(question, other))) continue;
      seen.add(key);
      accepted.push(question);
      newlyAccepted.push(question);
      if (accepted.length >= requested) break;
    }
    if (newlyAccepted.length) deps.onAccepted?.(newlyAccepted);
    consecutiveEmptyRounds = newlyAccepted.length ? 0 : consecutiveEmptyRounds + 1;
    onProgress({ requested, ready: accepted.length, attempt, phase: accepted.length >= requested ? "ready" : "reviewing" });
    // A fully rejected batch is a quality outcome, not a provider failure: use the remaining
    // attempts to generate fresh candidates. Transport, quota, and reviewer availability errors
    // cannot improve inside this preparation run, so stop those immediately.
    // An empty/rejected batch is recoverable: the next round rotates objective and atom evidence
    // and gives the model a fresh chance. Stop immediately only for transport/provider failures;
    // otherwise a single over-strict audit response used to strand the whole quiz at 0/N.
    if (!result.questions?.length && result.error && isProviderFailure(result.error)) break;
    // Two rounds without one new usable question is a strong signal that the
    // current evidence/model combination will not improve during this run.
    // Stop instead of making the learner wait through several more minute-long
    // generation and review calls.
    if (consecutiveEmptyRounds >= 2) break;
  }

  if (accepted.length < requested) {
    const usablePartial = accepted.length >= Math.min(requested, Math.max(3, Math.ceil(requested * 0.6)));
    return {
      ...(usablePartial
        ? { warning: `Starting with ${accepted.length} prepared questions. ${requested - accepted.length} unavailable slots were omitted.` }
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
