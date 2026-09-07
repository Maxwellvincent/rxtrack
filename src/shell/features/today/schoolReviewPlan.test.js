import { describe, expect, it } from "vitest";
import { nextSchoolReview } from "./schoolReviewPlan.js";

const now = Date.parse("2026-09-07T12:00:00Z");
const bank = { filename: "DM+ExamSoft+Quiz+1.pdf" };
const attempt = (submittedAt) => ({ sourceType: "question-bank", sourceFile: bank.filename, status: "submitted", submittedAt });

describe("nextSchoolReview", () => {
  it("offers one diagnostic pass for an untouched ExamSoft bank", () => {
    expect(nextSchoolReview({ banks: [bank], now })).toMatchObject({ pass: 1, due: true, mode: "Practice" });
  });
  it("spaces the repair pass and makes the third pass timed", () => {
    const first = attempt(now - 2 * 86400000);
    expect(nextSchoolReview({ banks: [bank], sessions: [first], now })).toMatchObject({ pass: 2, due: false });
    const second = attempt(now - 3 * 86400000);
    expect(nextSchoolReview({ banks: [bank], sessions: [first, second], now })).toMatchObject({ pass: 3, due: true, mode: "Timed" });
  });
  it("stops scheduling a bank after three completed passes", () => {
    expect(nextSchoolReview({ banks: [bank], sessions: [attempt(now), attempt(now), attempt(now)], now })).toBeNull();
  });
  it("ignores homework and returns only one next action", () => {
    const result = nextSchoolReview({ banks: [{ filename: "Week 1 homework.pdf" }, bank, { filename: "ESoft 2.pdf" }], now });
    expect(result.filename).toBe(bank.filename);
  });
});
