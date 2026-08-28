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
  const all = Object.values(banks || {}).flat().filter((q) => q && q.stem && q.choices);
  const filenames = Object.values(meta || {})
    .filter((entry) => entry && entry.blockId === blockId)
    .map((entry) => entry.filename);
  const scoped = filenames
    .flatMap((filename) => banks?.[filename] || [])
    .filter((q) => q && q.stem && q.choices);
  if (!blockId) return all;
  return scoped.length ? scoped : all.filter(q => q.blockId === blockId);
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
    }))
    .filter((a) => a.content);
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
    const selected = selectAtomsForQuiz(atoms, progress, config.count);
    const result = await generateFromAtoms(
      { atoms: selected, objectives: config.objectives, subject: config.subject, difficulty: config.difficulty, examples: config.examples, avoidStems: config.avoidStems },
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
