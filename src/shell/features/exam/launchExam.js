// Task 8, Part B — orchestration for launching an Integrated Exam session.
//
// Thin wrapper: allocates questions (Task 4), generates them (Task 5),
// shapes and persists the session (Task 2). No logic re-implemented from
// those functions here — this just sequences the calls and decides what
// counts as a hard failure vs. a partial-success success.

import { allocateQuestions } from "./allocation.js";
import { generateExamQuestions } from "./generation.js";
import { createSessionShape } from "../../../examSessions.js";
import { checkExamAccess } from "../../../supabase.js";
import { createQuestionPool } from "../../../questionPool.js";
import { read as readLearnerEvidence } from "../../../stores/learnerEvidence.js";

// Same fallback pattern as generation.js's makeQuestionId — reused here for
// consistency rather than inventing a second id-generation approach.
function makeSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Runs the full launch sequence for an Integrated Exam session: allocate →
 * generate → shape → persist. Returns `{ok: true, sessionId, generationErrors}`
 * on success or `{ok: false, error}` on failure (either zero questions
 * generated, or `createExamSession` rejecting the write).
 */
const activeLaunches = new Set();
export async function launchExamSession(args, deps = {}) {
  const key = `${args.userId}:${args.blockId}`;
  if (activeLaunches.has(key)) return { ok: false, error: "Questions are already being prepared for this block. Check background progress, then retry." };
  activeLaunches.add(key);
  try { return await runLaunch(args, deps); }
  finally { activeLaunches.delete(key); }
}

async function runLaunch(
  {
    userId,
    blockId,
    format,
    questionCount,
    durationMinutes,
    eligibleLectures,
    objectivesByLecture,
    atomsByLecture,
    lecturesById,
    lectures,
    weakConceptAccuracyByLecture,
    weakConcepts,
    learnerEvidence,
    prepareOnly = false,
    savedOnly = false,
  },
  deps = {}
) {
  const sessionId = makeSessionId();
  deps.onProgress?.({ message: "Checking exam storage access…", completed: 0 });
  await checkExamAccess(userId);
  const pool = deps.pool || createQuestionPool(userId, blockId);
  await pool.begin(sessionId, { requestedCount: questionCount, prepareOnly });
  const startedGenerationAt = Date.now();
  try {

  const allocation = allocateQuestions({
    eligibleLectures,
    requestedCount: questionCount,
    weakConcepts,
    learnerEvidence: learnerEvidence || readLearnerEvidence(userId),
    blockId,
    sessionId,
  });

  const { questions, errors: generationErrors, cacheHits = 0 } = await generateExamQuestions(
    {
      allocation,
      lecturesById,
      objectivesByLecture,
      atomsByLecture,
      blockId,
      lectures,
      weakConceptAccuracyByLecture,
      userId,
      generationId: sessionId,
    },
    { ...deps, pool, savedOnly }
  );

  await pool.finish(sessionId, { status: "complete", readyCount: questions?.length || 0,
    cacheHits, durationMs: Date.now() - startedGenerationAt, errors: generationErrors,
    questionIds: (questions || []).map(q => q.poolId).filter(Boolean) });

  if (!questions || questions.length === 0) {
    return {
      ok: false,
      error: "Could not generate any questions — try again or reduce the question count.",
    };
  }

  if (prepareOnly) return { ok: true, prepared: questions.length, cacheHits, generationErrors };
  if (format === "exam" && questions.length < questionCount && !savedOnly) {
    return {
      ok: false,
      readyCount: questions.length,
      canStartSaved: questions.length > 0,
      error: `${questions.length}/${questionCount} questions are saved and ready. The timed exam has not started. You can start with the saved questions now or retry later to fill the remaining slots. ${generationErrors[0]?.message || ""}`,
    };
  }

  const lectureIds = [...new Set(questions.map((q) => q.lectureId))];

  const startedAt = format === "exam" ? Date.now() : null;
  const scaledDurationMinutes = format === "exam" && questions.length < questionCount
    ? durationMinutes * (questions.length / questionCount)
    : durationMinutes;
  const deadline = format === "exam" ? startedAt + scaledDurationMinutes * 60_000 : null;

  const session = createSessionShape({
    sessionId,
    blockId,
    lectureIds,
    format,
    questions,
    startedAt,
    deadline,
  });

  deps.onProgress?.({ message: `Saving ${questions.length} questions…`, completed: questions.length, total: questions.length });
  const result = await pool.commit(session);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, sessionId, generationErrors, cacheHits };
  } catch (error) {
    await pool.finish(sessionId, { status: "error", error: error.message, durationMs: Date.now() - startedGenerationAt }).catch(() => {});
    throw error;
  }
}
