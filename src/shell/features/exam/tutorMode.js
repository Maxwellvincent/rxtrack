/**
 * Task 10 — Tutor mode request logic.
 *
 * Tutor mode is supplemental content shown after a question is revealed: a
 * breakdown of what the vignette was actually asking (the buried clause
 * after several sentences of vitals/labs/history, the qualifier that narrows
 * the answer) — distinct from, and never a replacement for, the existing
 * right/wrong explanation already rendered by ExamSessionRunner.jsx.
 *
 * `explainQuestion` follows this codebase's DI convention exactly like
 * `generateMcqs`/`startObjectiveQuiz`: it takes the AI transport via
 * `deps.callAI`, never imports `callAI` directly, so it's testable without a
 * live model. `callAI` (unlike `callAIJSON`) THROWS on failure — see
 * src/aiClient.js — so this function catches that and returns `{error}`
 * rather than letting a supplemental-content failure break the exam UI
 * around it.
 */

const TUTOR_SYSTEM_PROMPT =
  "You are a medical exam tutor. You are given a vignette-style multiple " +
  "choice question that a student has already answered and already been " +
  "shown the standard explanation for. Your job is SUPPLEMENTAL to that " +
  "explanation, not a replacement for it: help the student parse the " +
  "question itself — identify the buried clause (often after several " +
  "sentences of vitals, labs, or history) that actually narrows the " +
  "answer, and the key qualifier in the stem that rules out distractors. " +
  "Do not restate the existing explanation's reasoning about why the " +
  "answer is correct — focus on how to read the question. Ground your " +
  "answer strictly in the stem, choices, correct answer, and explanation " +
  "given below; do not introduce facts not implied by them. Keep it " +
  "concise — a short paragraph, not a new question.";

/**
 * Builds the user prompt for `callAI`, grounded in the frozen question data
 * (stem/choices/correct/explanation) so the output can't drift from what's
 * actually being tested.
 */
export function buildTutorPrompt({ stem, choices, correct, explanation, lectureLabel }) {
  const choiceLines = Object.entries(choices || {})
    .map(([letter, text]) => `${letter}. ${text}`)
    .join("\n");

  return [
    lectureLabel ? `Lecture: ${lectureLabel}` : null,
    `Question stem:\n${stem || ""}`,
    `Choices:\n${choiceLines}`,
    `Correct answer: ${correct || ""}`,
    explanation ? `Existing explanation (do not repeat this — this is what the student already saw):\n${explanation}` : null,
    "Explain how to parse this question — what it was actually asking, and the buried qualifier that narrows it to the correct answer.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * async, DI'd — calls deps.callAI(systemPrompt, userPrompt, maxTokens).
 * Returns { text } on success, { error } on failure (never throws).
 */
export async function explainQuestion(question, deps = {}) {
  const { callAI, maxTokens = 500 } = deps;
  const userPrompt = buildTutorPrompt({
    stem: question?.stem,
    choices: question?.choices,
    correct: question?.correct,
    explanation: question?.explanation,
    lectureLabel: question?.lectureLabel,
  });

  try {
    const text = await callAI(TUTOR_SYSTEM_PROMPT, userPrompt, maxTokens);
    return { text };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}
