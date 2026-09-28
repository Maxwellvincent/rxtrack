import { describe, expect, it } from "vitest";
import { namePreparedReplacementAttempt, suggestedExamName } from "./preparedSetNaming.js";

describe("prepared replacement naming", () => {
  it("distinguishes newly generated replacement content from the original named exam", () => {
    expect(namePreparedReplacementAttempt("Exam 1", [{ title: "Exam 1" }])).toBe("Exam 1 — New questions 2");
  });

  it("increments the suffix without reusing an existing attempt name", () => {
    expect(namePreparedReplacementAttempt("Exam 1", [
      { title: "Exam 1" },
      { title: "Exam 1 — New questions 2" },
      { title: "Exam 1 — New questions 4" },
    ])).toBe("Exam 1 — New questions 5");
  });
});

describe("suggested exam names", () => {
  it("includes format, scope, count, and date without a generic placeholder", () => {
    expect(suggestedExamName({ format: "practice", scopeLabel: "Week 2", questionCount: 15, now: new Date(2026, 8, 28) }))
      .toBe("Practice quiz · Week 2 · 15 questions · Sep 28, 2026");
    expect(suggestedExamName({ format: "exam", scopeLabel: "Block so far", questionCount: 20, now: new Date(2026, 8, 28) }))
      .toBe("Timed exam · Block so far · 20 questions · Sep 28, 2026");
  });

  it("adds a set number when the suggested title is already in use", () => {
    const options = { format: "exam", scopeLabel: "Week 2", questionCount: 20, now: new Date(2026, 8, 28) };
    const base = suggestedExamName(options);
    expect(suggestedExamName({ ...options, existingNames: [base, `${base} · Set 2`] })).toBe(`${base} · Set 3`);
  });
});
