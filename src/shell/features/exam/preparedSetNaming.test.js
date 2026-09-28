import { describe, expect, it } from "vitest";
import { namePreparedReplacementAttempt } from "./preparedSetNaming.js";

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
