import { describe, it, expect } from "vitest";
import { parseProperLearningPath, resolveBlock } from "./ankiPaths.js";

describe("parseProperLearningPath", () => {
  it("parses term/block/lecture/author from a full path", () => {
    const p = parseProperLearningPath(
      "AnKing::Proper Learning::Term 1::CPR 1::Week 10::CPR Lecture 1: Histology::Mikey"
    );
    expect(p).toEqual({
      term: "Term 1",
      block: "CPR 1",
      subject: "Week 10",
      lecture: "CPR Lecture 1: Histology",
      author: "Mikey",
    });
  });

  it("parses when only term+block present", () => {
    const p = parseProperLearningPath("AnKing::Proper Learning::Term 1::MSK");
    expect(p).toEqual({ term: "Term 1", block: "MSK", subject: null, lecture: null, author: null });
  });

  it("returns null for non-Proper-Learning decks", () => {
    expect(parseProperLearningPath("AnKing::Proper Learning+::Anatomy- Radiology::Abdomen")).toBeNull();
    expect(parseProperLearningPath("AnKing::Dr. Pickle's Anki::Term 1")).toBeNull();
  });

  it("returns null for non-Term branches under Proper Learning (anatomy/image decks)", () => {
    expect(parseProperLearningPath("AnKing::Proper Learning::Anatomy- Radiology::Abdomen")).toBeNull();
    expect(parseProperLearningPath("AnKing::Proper Learning::Anatomy- Radiology::Back::Pickle")).toBeNull();
  });
});

describe("resolveBlock", () => {
  const terms = [{ id: "term1", name: "Term 1", blocks: [{ id: "ftm1", name: "FTM 1" }, { id: "msk", name: "MSK" }] }];
  it("matches an existing block by normalized name", () => {
    expect(resolveBlock("FTM 1", terms)).toEqual({ blockId: "ftm1", termId: "term1" });
    expect(resolveBlock("msk", terms)).toEqual({ blockId: "msk", termId: "term1" });
  });
  it("falls back to a slug when no match", () => {
    expect(resolveBlock("CPR 2", terms)).toEqual({ blockId: "cpr-2", termId: null });
  });
});
