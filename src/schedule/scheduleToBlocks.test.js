import { describe, it, expect } from "vitest";
import { scheduleToBlocks } from "./scheduleToBlocks.js";

const ev = (date, system, activity, number, extra = {}) => ({ date, system, activity, number, ...extra });

describe("scheduleToBlocks", () => {
  const events = [
    ev("2026-08-12", "ER", "lecture", 1),
    ev("2026-08-12", "ER", "lecture", 2),
    ev("2026-08-13", "ER", "lecture", 3),
    ev("2026-08-31", "ER", "Exam", 1),
    ev("2026-09-02", "DM", "lecture", 1),
    ev("2026-09-30", "DM", "Exam", 2),
    ev("2026-08-18", "ER", "IMCQ", 1), // non-lecture, ignored for lecture list
    ev("2026-12-10", "ER", "Exam", 1, { location: "Belford 2 (East)" }), // completion retake — later, ignored
    // 3rd system NB: primary exam is the null-system cumulative "Exam 03"; a
    // December system-tagged "NB Exam 3" is only the completion/makeup sitting.
    ev("2026-10-01", "NB", "lecture", 1),
    ev("2026-10-23", null, "Exam", 3),
    ev("2026-12-11", "NB", "Exam", 3, { location: "Belford 2 (East) Completion" }),
  ];
  const blocks = scheduleToBlocks(events);

  it("makes one block per system, in first-seen order", () => {
    expect(blocks.map((b) => b.system)).toEqual(["ER", "DM", "NB"]);
  });
  it("maps a null-system cumulative Exam to its block by ordinal (NB = 3rd → Exam 03)", () => {
    expect(blocks.find((b) => b.system === "NB").examDate).toBe("2026-10-23");
  });
  it("startDate = earliest event date for the system", () => {
    expect(blocks.find((b) => b.system === "ER").startDate).toBe("2026-08-12");
    expect(blocks.find((b) => b.system === "DM").startDate).toBe("2026-09-02");
  });
  it("examDate = earliest matching-system Exam", () => {
    expect(blocks.find((b) => b.system === "ER").examDate).toBe("2026-08-31");
    expect(blocks.find((b) => b.system === "DM").examDate).toBe("2026-09-30");
  });
  it("lectures = deduped sorted {number,date}, non-lectures excluded", () => {
    const er = blocks.find((b) => b.system === "ER");
    expect(er.lectures).toEqual([
      { number: 1, date: "2026-08-12" },
      { number: 2, date: "2026-08-12" },
      { number: 3, date: "2026-08-13" },
    ]);
  });
  it("carries a default block name per system", () => {
    expect(blocks.find((b) => b.system === "ER").name).toMatch(/Endocrine/i);
    expect(blocks.find((b) => b.system === "DM").name).toMatch(/Metabolism|Diabetes/i);
  });
});
