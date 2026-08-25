import { describe, expect, it } from "vitest";
import { matchReviewToLecture } from "../../../scripts/struggle-review-match.mjs";

const lectures = [
  { id: "female", lectureTitle: "Female Reproductive System I" },
  { id: "pelvis", lectureTitle: "Pelvis and Perineum III" },
  { id: "male", lectureTitle: "Male Reproductive System" },
];

describe("Anki review lecture matching", () => {
  it("matches a nested Proper Learning deck to its lecture", () => {
    expect(matchReviewToLecture({ deck: "AnKing::Proper Learning::Term 2::ER::Female Reproductive System I" }, lectures)?.id).toBe("female");
  });

  it("matches most of a lecture title when the deck has extra grouping", () => {
    expect(matchReviewToLecture({ deck: "Term 2::Week 3::Pelvis & Perineum III::Pickle" }, lectures)?.id).toBe("pelvis");
  });

  it("refuses an ambiguous or unrelated deck", () => {
    expect(matchReviewToLecture({ deck: "AnKing::Endocrine::General Review" }, lectures)).toBeNull();
  });
});
