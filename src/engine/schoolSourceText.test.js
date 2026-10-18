import { expect, it } from "vitest";
import { cleanSchoolQuestion } from "./schoolSourceText.js";
it("removes a trailing PDF question-range header while retaining extracted source and answer key", () => {
 const original = { choices: { A: "Facial", E: "Chorda tympani Questions 51.75" }, correct: "E" };
 const cleaned = cleanSchoolQuestion(original);
 expect(cleaned.choices.E).toBe("Chorda tympani");
 expect(cleaned.correct).toBe("E");
 expect(cleaned.sourceChoiceText.E).toBe("Chorda tympani Questions 51.75");
 expect(original.choices.E).toContain("Questions 51.75");
 expect(cleanSchoolQuestion(cleaned)).toBe(cleaned);
});
it("preserves clinical ranges, figure labels, and numbered answer content", () => {
 for (const text of ["5–10 mg", "Questions about cranial nerves", "Figure 7.2", "Types 51.75", "Question 5", "pH 7.35–7.45"]) {
  expect(cleanSchoolQuestion({ choices: { A: text } }).choices.A).toBe(text);
 }
});
