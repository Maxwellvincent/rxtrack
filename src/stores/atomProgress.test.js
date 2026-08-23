import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as atomProgress from "./atomProgress.js";

// Signed out, so the store answers straight out of localStorage.
describe("atomProgress store", () => {
  beforeEach(() => installDomStorage());

  it("has no progress for an atom never answered", () => {
    expect(atomProgress.progressForLecture(null, "lec1")).toEqual({});
  });

  it("marks an atom complete on its first correct answer", () => {
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", true);
    const entry = atomProgress.progressForLecture(null, "lec1").thyroglobulin;
    expect(entry).toMatchObject({ status: "complete", correctCount: 1, missCount: 0 });
  });

  it("marks an atom needs-review on a miss", () => {
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", false);
    const entry = atomProgress.progressForLecture(null, "lec1").thyroglobulin;
    expect(entry).toMatchObject({ status: "needs-review", correctCount: 0, missCount: 1 });
  });

  it("flips a complete atom back to needs-review on a later miss — mastery is not permanent", () => {
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", true);
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", false);
    const entry = atomProgress.progressForLecture(null, "lec1").thyroglobulin;
    expect(entry).toMatchObject({ status: "needs-review", correctCount: 1, missCount: 1 });
  });

  it("flips a needs-review atom back to complete on a later correct answer", () => {
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", false);
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", true);
    const entry = atomProgress.progressForLecture(null, "lec1").thyroglobulin;
    expect(entry).toMatchObject({ status: "complete", correctCount: 1, missCount: 1 });
  });

  it("keeps atoms and lectures separate", () => {
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", true);
    atomProgress.recordAtomAnswer(null, "lec1", "pendrin", false);
    atomProgress.recordAtomAnswer(null, "lec2", "thyroglobulin", false);
    expect(atomProgress.progressForLecture(null, "lec1").thyroglobulin.status).toBe("complete");
    expect(atomProgress.progressForLecture(null, "lec1").pendrin.status).toBe("needs-review");
    expect(atomProgress.progressForLecture(null, "lec2").thyroglobulin.status).toBe("needs-review");
  });

  it("ignores an answer with no lecture or atom key to attach it to", () => {
    atomProgress.recordAtomAnswer(null, null, "thyroglobulin", true);
    atomProgress.recordAtomAnswer(null, "lec1", null, true);
    expect(atomProgress.read(null)).toEqual({});
  });

  describe("masterySummary", () => {
    it("counts only atoms currently on the lecture", () => {
      atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", true);
      atomProgress.recordAtomAnswer(null, "lec1", "pendrin", true);
      atomProgress.recordAtomAnswer(null, "lec1", "removed-atom", true);
      const summary = atomProgress.masterySummary(null, "lec1", ["thyroglobulin", "pendrin", "tsh-receptor"]);
      expect(summary).toEqual({ masteredCount: 2, totalCount: 3 });
    });

    it("zeroes out for a lecture never touched", () => {
      expect(atomProgress.masterySummary(null, "lec1", ["a", "b"])).toEqual({ masteredCount: 0, totalCount: 2 });
    });
  });

  describe("needsReview", () => {
    it("lists only needs-review atoms, most recently missed first", async () => {
      atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", false);
      await new Promise((r) => setTimeout(r, 2));
      atomProgress.recordAtomAnswer(null, "lec1", "pendrin", false);
      atomProgress.recordAtomAnswer(null, "lec1", "tsh-receptor", true);
      expect(atomProgress.needsReview(null, "lec1")).toEqual(["pendrin", "thyroglobulin"]);
    });

    it("is empty once every missed atom is corrected", () => {
      atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", false);
      atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", true);
      expect(atomProgress.needsReview(null, "lec1")).toEqual([]);
    });
  });

  it("clears one lecture without touching the others", () => {
    atomProgress.recordAtomAnswer(null, "lec1", "thyroglobulin", true);
    atomProgress.recordAtomAnswer(null, "lec2", "thyroglobulin", true);
    atomProgress.clearLecture(null, "lec1");
    expect(atomProgress.progressForLecture(null, "lec1")).toEqual({});
    expect(atomProgress.progressForLecture(null, "lec2").thyroglobulin.status).toBe("complete");
  });
});
