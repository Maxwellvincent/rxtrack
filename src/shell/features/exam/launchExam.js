// Task 8, Part B — orchestration for launching an Integrated Exam session.
//
// Thin wrapper: allocates questions (Task 4), generates them (Task 5),
// shapes and persists the session (Task 2). No logic re-implemented from
// those functions here — this just sequences the calls and decides what
// counts as a hard failure vs. a partial-success success.

import { allocateQuestions } from "./allocation.js";
import { generateExamQuestions } from "./generation.js";
import { createSessionShape } from "../../../examSessions.js";
import { createExamSession } from "../../../supabase.js";

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
export async function launchExamSession(
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
  },
  deps = {}
) {
  const sessionId = makeSessionId();

  const allocation = allocateQuestions({
    eligibleLectures,
    requestedCount: questionCount,
    weakConcepts,
    blockId,
    sessionId,
  });

  const { questions, errors: generationErrors } = await generateExamQuestions(
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
    deps
  );

  if (!questions || questions.length === 0) {
    return {
      ok: false,
      error: "Could not generate any questions — try again or reduce the question count.",
    };
  }

  const lectureIds = [...new Set(questions.map((q) => q.lectureId))];

  const startedAt = format === "exam" ? Date.now() : null;
  const deadline = format === "exam" ? startedAt + durationMinutes * 60_000 : null;

  const session = createSessionShape({
    sessionId,
    blockId,
    lectureIds,
    format,
    questions,
    startedAt,
    deadline,
  });

  const result = await createExamSession(userId, session);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, sessionId, generationErrors };
}
