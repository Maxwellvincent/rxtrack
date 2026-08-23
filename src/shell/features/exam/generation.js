// Task 5 — per-lecture question generation & provenance for the Integrated
// Exam tab.
//
// Given Task 4's `allocateQuestions` output (`{[lectureId]: count}`), this
// generates the actual questions — one `startObjectiveQuiz` call per lecture
// (never one call per question), stamps each surviving question with
// immutable provenance, and returns a pool the rest of the feature can trust.
//
// Reuses `startObjectiveQuiz` from quizLaunch.js rather than reimplementing
// prompt-building or the text/atoms branching — that pipeline (buildQuizConfig,
// generateMcqs vs generateFromAtoms) already exists and is exercised by the
// existing per-lecture Quiz mode.

import { readExemplarsForBlock, resolveDefaultDifficulty, startObjectiveQuiz } from "../objectives/quizLaunch.js";

const MAX_ATTEMPTS = 3; // initial attempt + 2 retries

function makeQuestionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * This codebase's shared `normalizeQuestions` (src/engine/mcq.js) deliberately
 * KEEPS table-shaped choices for a future table renderer that doesn't exist
 * yet for the exam tab's session UI — a later task's AtomQuiz.jsx-based
 * renderer would throw on an object child. Filter those out here; this is
 * exam-tab-specific filtering, not a change to the shared prompt/normalizer.
 */
function isRenderableQuestion(q) {
  if (!q || q.choiceLayout === "table" || !q.choices || typeof q.choices !== "object") return false;
  return Object.values(q.choices).every((v) => typeof v === "string");
}

/**
 * Generates the exam pool for a per-lecture allocation. See task brief for
 * the full algorithm; the short version: for each lecture with a non-zero
 * allocation, call `startObjectiveQuiz` once per attempt (up to 3 attempts —
 * the initial call plus 2 retries for any shortfall), filter out
 * table-shaped/non-string choices, and stamp every surviving question with
 * provenance before flattening everything into one pool.
 */
export async function generateExamQuestions(
  {
    allocation,
    lecturesById,
    objectivesByLecture,
    atomsByLecture,
    blockId,
    lectures,
    weakConceptAccuracyByLecture,
    userId,
  },
  deps = {}
) {
  const questions = [];
  const errors = [];

  // Called once, not once per lecture — the block-filtered exemplar set
  // doesn't vary by lecture, so there's no reason to re-read/re-filter the
  // question-bank store on every iteration of the loop below.
  const exemplars = readExemplarsForBlock(userId, blockId);

  const lectureIds = Object.keys(allocation || {}).filter((id) => (allocation[id] || 0) > 0);

  for (const lectureId of lectureIds) {
    const requested = allocation[lectureId];
    const objectives = objectivesByLecture?.[lectureId] || [];
    const atoms = atomsByLecture?.[lectureId] || [];
    const lecture = lecturesById?.[lectureId];
    const lectureTitle = lecture?.lectureTitle || lecture?.fileName;
    const difficulty = resolveDefaultDifficulty(weakConceptAccuracyByLecture?.[lectureId]);
    const objectiveIds = objectives.map((o) => o?.id).filter(Boolean);

    const survivors = [];
    let stillNeeded = requested;
    let attempt = 0;

    while (stillNeeded > 0 && attempt < MAX_ATTEMPTS) {
      attempt += 1;
      const result = await startObjectiveQuiz(
        {
          objectives,
          lectureTitle,
          blockId,
          lectures,
          exemplars,
          atoms,
          difficulty,
          questionCount: stillNeeded,
        },
        deps
      );

      const generated = Array.isArray(result?.questions) ? result.questions : [];
      const renderable = generated.filter(isRenderableQuestion);
      survivors.push(...renderable);
      stillNeeded = requested - survivors.length;
    }

    for (const q of survivors) {
      questions.push({
        ...q,
        questionId: makeQuestionId(),
        blockId,
        lectureId,
        objectiveIds,
      });
    }

    if (survivors.length < requested) {
      errors.push({
        lectureId,
        requested,
        obtained: survivors.length,
        message: `Only generated ${survivors.length} of ${requested} requested questions for this lecture after ${attempt} attempt(s).`,
      });
    }
  }

  return { questions, errors };
}
