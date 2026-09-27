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
    startWhilePreparing = false,
    studyMode = "balanced",
    difficultyOverride = null,
    focusNotes = "",
    examName = "Integrated exam",
    contentScope = "block-so-far",
    weekNumber = null,
    preparedGenerationId = null,
    preparedQuestionIds = [],
  },
  deps = {}
) {
  const sessionId = makeSessionId();
  const resolvedContentScope = weekNumber != null ? `week-number:${weekNumber}` : contentScope;
  deps.onProgress?.({ message: "Checking exam storage access…", completed: 0 });
  await checkExamAccess(userId);
  const pool = deps.pool || createQuestionPool(userId, blockId);
  await pool.begin(sessionId, { requestedCount: questionCount, prepareOnly, examName, contentScope: resolvedContentScope, format, durationMinutes, studyMode, difficultyOverride, focusNotes, weekNumber });
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

  if (startWhilePreparing && !prepareOnly && !savedOnly) {
    const savedResult = await generateExamQuestions(
      { allocation, lecturesById, objectivesByLecture, atomsByLecture, blockId, lectures,
        weakConceptAccuracyByLecture, userId, generationId: sessionId, studyMode, difficultyOverride, focusNotes, preparedGenerationId, preparedQuestionIds },
      { ...deps, pool, savedOnly: true }
    );
    const savedQuestions = savedResult.questions || [];
    const savedCounts = savedQuestions.reduce((counts, question) => {
      if (question.lectureId) counts[question.lectureId] = (counts[question.lectureId] || 0) + 1;
      return counts;
    }, {});
    const missingAllocation = Object.fromEntries(Object.entries(allocation)
      .map(([lectureId, count]) => [lectureId, Math.max(0, count - (savedCounts[lectureId] || 0))])
      .filter(([, count]) => count > 0));
    const session = createSessionShape({
      sessionId,
      blockId,
      lectureIds: [...new Set([...savedQuestions.map(q => q.lectureId), ...Object.keys(missingAllocation)])],
      format,
      title: examName,
      contentScope: resolvedContentScope,
      questions: savedQuestions,
      startedAt: null,
      deadline: null,
      studyMode,
      fillStatus: "generating",
      targetQuestionCount: questionCount,
      durationMinutes: format === "exam" ? durationMinutes : null,
    });
    deps.onProgress?.({ message: `Opening with ${savedQuestions.length}/${questionCount} saved questions · generating the rest`, completed: savedQuestions.length, total: questionCount });
    const committed = await pool.commit(session);
    if (!committed.ok) return { ok: false, error: committed.error };

    void (async () => {
      let result = { questions: [], errors: [] };
      let fillError = "";
      try {
        if (Object.keys(missingAllocation).length) {
          result = await generateExamQuestions(
            { allocation: missingAllocation, lecturesById, objectivesByLecture, atomsByLecture,
              blockId, lectures, weakConceptAccuracyByLecture, userId, generationId: sessionId,
              studyMode, difficultyOverride, focusNotes },
            { ...deps, pool, savedOnly: false,
              onQuestionReady: question => pool.appendToSession(sessionId, question, { requestedCount: questionCount, durationMinutes }) }
          );
          if (result.errors?.length) fillError = result.errors.map(item => item.message).join(" ");
        }
      } catch (error) {
        fillError = error?.message || String(error);
      }
      await pool.finishSessionFill(sessionId, { requestedCount: questionCount, durationMinutes, error: fillError }).catch(() => {});
      await pool.finish(sessionId, { status: fillError ? "partial" : "complete",
        readyCount: savedQuestions.length + (result.questions?.length || 0), errors: result.errors || [],
        durationMs: Date.now() - startedGenerationAt }).catch(() => {});
    })();
    return { ok: true, sessionId, generationErrors: [], cacheHits: savedResult.cacheHits || 0 };
  }

  const { questions, errors: generationErrors, cacheHits = 0, coverage = null } = await generateExamQuestions(
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
      studyMode,
      difficultyOverride,
      focusNotes,
    },
    { ...deps, pool, savedOnly }
  );

  await pool.finish(sessionId, { status: "complete", readyCount: questions?.length || 0,
    cacheHits, durationMs: Date.now() - startedGenerationAt, errors: generationErrors,
    questionIds: (questions || []).map(q => q.poolId).filter(Boolean),
    ...(prepareOnly ? { preparedQuestionIds: (questions || []).map(q => q.poolId).filter(Boolean) } : {}) });

  if (!questions || questions.length === 0) {
    return {
      ok: false,
      error: savedOnly
        ? "No saved questions match this block's current exam scope. Choose a broader block-so-far scope or prepare questions first."
        : "Could not generate any questions — try again or reduce the question count.",
    };
  }

  if (prepareOnly) return { ok: true, prepared: questions.length, cacheHits, generationErrors, coverage };
  if (format === "exam" && questions.length < questionCount) {
    return {
      ok: false,
      readyCount: questions.length,
      canStartSaved: questions.length > 0,
      coverage,
      error: savedOnly
        ? `${questions.length}/${questionCount} saved questions match this scope. Nothing was generated and the timer has not started; broaden the date scope or prepare more questions.`
        : `${questions.length}/${questionCount} questions are saved and ready. The timed exam has not started. You can start with the saved questions now or retry later to fill the remaining slots. ${generationErrors[0]?.message || ""}`,
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
    title: examName,
    contentScope: resolvedContentScope,
    questions,
    startedAt,
    deadline,
    studyMode,
  });

  deps.onProgress?.({ message: `Saving ${questions.length} questions…`, completed: questions.length, total: questions.length });
  const result = await pool.commit(session);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, sessionId, generationErrors, cacheHits, coverage };
  } catch (error) {
    await pool.finish(sessionId, { status: "error", error: error.message, durationMs: Date.now() - startedGenerationAt }).catch(() => {});
    throw error;
  }
}
