/**
 * Deduplicate MCQ choices by normalized option text; remap correct letter to match new A–D order.
 * Returns { valid: false } if fewer than 4 distinct non-empty options remain.
 */
export function dedupeMcqQuestionChoices(q) {
  if (!q || typeof q !== "object") return { valid: false, q };
  const letters = ["A", "B", "C", "D"];
  const choices = q.choices || {};
  const seen = new Set();
  const uniq = [];
  for (const L of letters) {
    const t = String(choices[L] ?? "").trim();
    if (!t) return { valid: false, q };
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ origLetter: L, text: t });
  }
  if (uniq.length < 4) return { valid: false, q };
  const newChoices = {
    A: uniq[0].text,
    B: uniq[1].text,
    C: uniq[2].text,
    D: uniq[3].text,
  };
  const correctOld = String(q.correct || "A")
    .toUpperCase()
    .replace(/[^A-D]/g, "")
    .slice(0, 1);
  const correctNorm = String(choices[correctOld] ?? "").trim().toLowerCase();
  let newCorrect = "A";
  for (let i = 0; i < 4; i++) {
    if (uniq[i].text.toLowerCase() === correctNorm) {
      newCorrect = letters[i];
      break;
    }
  }
  return {
    valid: true,
    q: { ...q, choices: newChoices, correct: newCorrect },
  };
}

/** Drill / quiz prompts: four options must be unique; correct text must not repeat in distractors. */
export const MCQ_OPTION_UNIQUENESS_CRITICAL = `CRITICAL: Each of the 4 answer options must be completely unique in text and meaning. Never reuse the same sequence, value, or phrase across multiple options. The correct answer text must not appear anywhere in the distractor options. Double-check all 4 options are distinct before returning.`;

/** Prompt snippets: distinct options + lab teaching points (injected into AI prompts only). */
export const MCQ_DISTINCT_OPTIONS_RULE = `CRITICAL: Every answer option must be numerically and textually distinct. Never repeat the same value across options. If generating numerical answers, ensure each option uses a different number. If the question involves a calculated or measured numerical result, generate distractors that represent common calculation errors or clinically meaningful adjacent values — never the same value twice.`;

export const MCQ_LAB_NORMAL_RANGES_RULE = `When generating questions involving lab values or calculated values, always include the relevant normal reference range in the teaching point explanation. Examples:
- LDL cholesterol: normal <100 mg/dL (optimal), <130 mg/dL (near optimal)
- Total cholesterol: normal <200 mg/dL
- HDL: normal >40 mg/dL (men), >50 mg/dL (women)
- Triglycerides: normal <150 mg/dL
- Blood glucose (fasting): normal 70-99 mg/dL
- HbA1c: normal <5.7%
- Blood pressure: normal <120/80 mmHg
- Creatinine: normal 0.7-1.3 mg/dL (men), 0.6-1.1 mg/dL (women)
Include the normal range as a dedicated line in the teaching point:
"Normal range: [value] — this patient's result is [interpretation]."`;

/** True if this MCQ result should count as "correct" for session % (excludes self-reported lucky guesses). */
export function mcqResultCountsTowardCorrectScore(r) {
  return !!(r && r.correct && r.confidenceFlag !== "guessed");
}
