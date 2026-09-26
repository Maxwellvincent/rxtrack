import { createSessionShape } from "../../../examSessions.js";
import { createExamSession } from "../../../supabase.js";
import { examDurationMs } from "./examTiming.js";

function makeSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bank_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function validBankQuestion(question) {
  const letters = Object.keys(question?.choices || {});
  const choiceLetters = letters.filter((letter) => /^[A-H]$/i.test(letter)).map((letter) => letter.toUpperCase()).sort();
  const choicesContiguous = !choiceLetters.length || choiceLetters.every((letter, index) => letter === String.fromCharCode(65 + index));
  const needsImage = !!(question?.hasImage || question?.imageDependent);
  const hasImage = !!(question?.sourceImageUrl || question?.sourceImageDataUrl || question?.image?.url || typeof question?.image === "string");
  return !!question?.stem && letters.length >= 2 && choicesContiguous && letters.includes(question?.correct) && (!needsImage || hasImage);
}

export function prepareQuestionBankQuestions(questions, { blockId, filename }) {
  return (questions || []).map((question, index) => ({
    ...question,
    questionId: `bank:${filename}:${question.id || question.num || "q"}:${index + 1}`,
    blockId,
    lectureId: null,
    objectiveIds: [],
    source: "Original school question",
    sourceFile: filename,
    sourceType: "question-bank",
  }));
}

export async function launchQuestionBankSession(
  { userId, blockId, filename, questions, format = "exam" },
  deps = {}
) {
  const create = deps.createExamSession || createExamSession;
  const sourceQuestions = questions || [];
  const invalidCount = sourceQuestions.filter((question) => !validBankQuestion(question)).length;
  if (!sourceQuestions.length) return { ok: false, error: "This question bank is empty." };
  if (invalidCount) {
    return {
      ok: false,
      error: `Cannot start: ${invalidCount} question${invalidCount === 1 ? " is" : "s are"} incomplete (stem, contiguous choices, keyed answer, or required figure missing). Re-import and verify the original before using this bank.`,
    };
  }

  const sessionId = makeSessionId();
  const prepared = prepareQuestionBankQuestions(sourceQuestions, { blockId, filename });
  const startedAt = format === "exam" ? Date.now() : null;
  const session = createSessionShape({
    sessionId,
    blockId,
    lectureIds: [],
    format,
    questions: prepared,
    startedAt,
    deadline: startedAt == null ? null : startedAt + examDurationMs(prepared.length),
    sourceType: "question-bank",
    sourceFile: filename,
  });
  const result = await create(userId, session);
  if (!result?.ok) return { ok: false, error: result?.error || "Could not create the quiz session." };
  return { ok: true, sessionId, questionCount: prepared.length, deadline: session.deadline };
}
