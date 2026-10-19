import { describe, expect, it } from "vitest";
import { parseAnswerExplanations } from "./answerExplanations.js";
import { selectStyleExemplars } from "../engine/mcq.js";
import { buildStyleProfile } from "../engine/styleProfile.js";
import { parseExamPDF } from "../examParser.js";
import { prepareQuestionBankQuestions, validBankQuestion } from "../shell/features/exam/launchQuestionBank.js";

const sample = `NB ESOFT 2 — Answer Explanations
Q2 — Muscle whose contraction causes anterior
 dislocation of the mandible (Answer: B)
• A ✗ — Masseter — Elevates the mandible.
• B ✓ — Lateral pterygoid — Pulls the mandibular head forward.
Q26 — Action potential phase overlapping the
relative refractory period (Answer: A)
• A ✓ — After-hyperpolarization — Potassium conductance remains
[PAGE_BREAK:3]
elevated during this period.
• B ✗ — Rest — Normal excitability.`;

describe("answer-explanation review handouts", () => {
  it("separates wrapped options from rationales and preserves source keys and numbers", () => {
    const result = parseAnswerExplanations(sample);
    expect(result.sourceQuestionCount).toBe(2);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({ num: 2, correct: "B", choices: { A: "Masseter", B: "Lateral pterygoid" } });
    expect(result.questions[0].stem).not.toMatch(/Answer:|Pulls/);
    expect(result.questions[1]).toMatchObject({ num: 26, choices: { A: "After-hyperpolarization", B: "Rest" } });
    expect(result.questions[1].choiceExplanations.A).toBe("Potassium conductance remains elevated during this period.");
    expect(result.questions[1].explanation).not.toContain("PAGE_BREAK");
    expect(result.questions.every(validBankQuestion)).toBe(true);
  });

  it("never mistakes a missing figure or letter-only exhibit for a usable question", () => {
    const result = parseAnswerExplanations(`Q1 — Hormone from the indicated structure (Answer: A)
• A ✓ — Hormone one — Source rationale.
• B ✗ — Hormone two — Source rationale.
Q11 — Location of a lesion (Answer: B)
• A ✗ — A — Proximal site.
• B ✓ — B — Distal site.
Q19 — Organ identified by histology (Answer: A)
• A ✓ — Organ one — Source rationale.
• B ✗ — Organ two — Source rationale.`);
    expect(result.questions).toEqual([]);
    expect(result.sourceIssues).toHaveLength(3);
    expect(result.sourceIssues.join(" ")).toMatch(/Q1:.*absent/);
  });

  it("withholds conflicting keys, incomplete options, and duplicated numbers", () => {
    const result = parseAnswerExplanations(sample.replace("• A ✗", "• A ✓") + `
Q26 — Another summary (Answer: A)
• A ✓ — One — Rationale.
• B ✗ — Two — Rationale.
Q30 — Incomplete summary (Answer: A)
• A ✓ — One — Rationale.
• C ✗ — Three — Rationale.`);
    expect(result.questions.map(q => q.num)).toEqual([26]);
    expect(result.sourceIssues.join(" ")).toMatch(/conflicting answer markers/);
    expect(result.sourceIssues.join(" ")).toMatch(/duplicate question number/);
    expect(result.sourceIssues.join(" ")).toMatch(/incomplete option/);
  });

  it("does not intercept ordinary banks or standalone answer keys", () => {
    expect(parseAnswerExplanations("1. Which muscle?\nA. One\nB. Two\nAnswer Key: 1 B")).toBeNull();
    expect(parseAnswerExplanations("Q1 Answer: B. Rationale.")).toBeNull();
  });

  it("imports locally and preserves the abbreviated provenance when launching", async () => {
    const parsed = await parseExamPDF({ name: "Explanation review.txt", text: async () => sample }, undefined, { requireSourceKeys: true });
    expect(parsed.format).toBe("answer-explanations");
    expect(parsed.expectedQuestions).toBe(2);
    expect(parsed.sourceNotice).toMatch(/not original exam/);
    const prepared = prepareQuestionBankQuestions(parsed.questions, { blockId: "b1", filename: "Explanation review" });
    expect(prepared.every(q => q.source === "Explanation-based review (abbreviated prompt)")).toBe(true);
    expect(prepared[0].sourceKind).toBe("supplemental");
    expect(selectStyleExemplars(prepared)).toEqual([]);
    expect(buildStyleProfile(prepared).sampleSize).toBe(0);
  });
});
