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
import { getLecText } from "../../../lectureText.js";

/** Weakest first — fewest consecutive correct answers get quizzed first. */
export function sortWeakestFirst(objectives) {
  return [...(objectives || [])].sort(
    (a, b) => (a?.consecutiveCorrect || 0) - (b?.consecutiveCorrect || 0)
  );
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
  difficulty = "medium",
  questionCount,
}) {
  const pool = sortWeakestFirst(objectives);
  const count = resolveQuestionCount(questionCount, Math.max(pool.length, 1));

  // When no objectives, fall through to atom/text-based generation
  const selected = pool.slice(0, Math.min(count, pool.length));
  const lecture = findLectureForQuiz(lectures, blockId, lectureTitle);
  const lectureText = lecture ? getLecText(lecture) : "";

  return {
    config: {
      subject: lectureTitle || "these objectives",
      objectives: selected,
      atoms,
      lectureText,
      examples: exemplars,
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
 * Two generators, same contract: with lecture text the questions are grounded in
 * the lecture (App's behavior); without it — imported objectives whose lecture
 * was never uploaded — the objectives themselves become the facts to test, one
 * question each, rather than failing the launch outright.
 */
export async function startObjectiveQuiz(args, deps = {}) {
  const atoms = Array.isArray(args.atoms) ? args.atoms : [];
  const built = buildQuizConfig(args);
  // Only error out if no objectives AND no atoms AND no lecture text hint
  if (built.error && !atoms.length) return { error: built.error, questions: [] };

  const { config, lectureId } = built;
  const hasText = String(config?.lectureText || "").trim().length >= MIN_LECTURE_TEXT;
  const hasObjectives = (config?.objectives || []).length > 0;

  // Prefer the full MCQ generator when we have text or objectives (or atoms as context)
  if (hasText || hasObjectives || atoms.length) {
    const result = await generateMcqs({ ...config, atoms }, deps);
    return { ...result, lectureId };
  }

  // Pure fallback: objectives-as-atoms when nothing else is available
  return {
    ...(await generateFromAtoms(
      {
        atoms: objectivesAsAtoms(config?.objectives || []),
        difficulty: config?.difficulty,
        examples: config?.examples,
        subject: config?.subject,
      },
      deps
    )),
    lectureId,
  };
}
