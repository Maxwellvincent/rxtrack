import { describe, it, expect } from "vitest";
import { selectNext } from "./selectConcept.js";

const C = (concept, masteryLevel, missCount = 0) => ({ concept, masteryLevel, missCount });

describe("selectNext", () => {
  it("prioritizes struggling, highest missCount first", () => {
    const out = selectNext([C("a", "developing"), C("b", "struggling", 1), C("c", "struggling", 5)], []);
    expect(out).toMatchObject({ concept: C("c", "struggling", 5), mode: "teach" });
  });
  it("falls to developing when no struggling", () => {
    const out = selectNext([C("a", "developing", 2), C("b", "mastered")], []);
    expect(out).toMatchObject({ mode: "recognize" });
    expect(out.concept.concept).toBe("a");
  });
  it("introduces a new concept when weak backlog is empty", () => {
    const out = selectNext([C("a", "mastered")], [{ concept: "newconcept" }]);
    expect(out).toMatchObject({ isNew: true, mode: "teach" });
    expect(out.concept.concept).toBe("newconcept");
  });
  it("tests a mastered concept only when nothing weak and no new pool", () => {
    const out = selectNext([C("a", "mastered")], []);
    expect(out).toMatchObject({ mode: "test" });
  });
  it("returns null when empty", () => {
    expect(selectNext([], [])).toBeNull();
  });
});
