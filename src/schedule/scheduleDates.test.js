import { describe, expect, it } from "vitest";
import { parseSchedule } from "./scheduleParser.js";
import { scheduleToBlocks, isAssessment } from "./scheduleToBlocks.js";
import { mergeScheduleIntoStores } from "./mergeSchedule.js";
import { migrateLectureDates } from "../maintenance/migrateLectureDates.js";

// A slice shaped like the real BPM2 markdown: dated headers, then timed events.
const MD = `
Mon, Aug 10
8:00am - 9:00am ABCD: BPM2 ER 1 Introduction (Hall A)
9:00am - 10:00am ABCD: BPM2 ER 2 Pituitary (Hall A)
Tue, Aug 11
8:00am - 9:00am ABCD: BPM2 ER 3 Thyroid (Hall A)
10:00am - 11:00am BPM2 ER ESoft Quiz 1 (Online)
Wed, Aug 12
8:00am - 9:00am A (Curie): BPM2 ER LAB 1 (Lab 2)
1:00pm - 3:00pm BPM2 ER IMCQ 1 (Hall B)
Mon, Aug 31
9:00am - 12:00pm BPM2 Exam 1 (Hall A)
`;

describe("schedule dates survive the whole import path", () => {
  const events = parseSchedule(MD);
  const blocks = scheduleToBlocks(events);

  it("parses a date onto every event", () => {
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.date)).toBe(true);
  });

  it("maps lecture dates into the block descriptor", () => {
    const er = blocks.find((b) => b.system === "ER");
    expect(er.lectures).toEqual([
      { number: 1, date: "2026-08-10" },
      { number: 2, date: "2026-08-10" },
      { number: 3, date: "2026-08-11" },
    ]);
    expect(er.examDate).toBe("2026-08-31");
    expect(er.startDate).toBe("2026-08-10");
  });

  it("writes the date to lectureDate — the field consumers actually read", () => {
    const merged = mergeScheduleIntoStores(blocks, { terms: [], examDates: {}, lectures: [] });
    const imported = merged.lectures.filter((l) => l.lectureNumber);

    expect(imported.length).toBe(3);
    for (const lecture of imported) {
      expect(lecture.lectureDate).toBeTruthy();
      expect(lecture.lectureDate).toBe(lecture.date);
    }
  });

  it("keeps quizzes, IMCQ and labs instead of dropping them", () => {
    const er = blocks.find((b) => b.system === "ER");
    const kinds = er.assessments.map((a) => a.activity);

    expect(kinds).toContain("ESoft Quiz");
    expect(kinds).toContain("IMCQ");
    expect(er.assessments.every((a) => a.date)).toBe(true);
    // The block exam is already on the block; it must not be duplicated here.
    expect(er.assessments.some((a) => a.date === er.examDate && /exam/i.test(a.activity))).toBe(false);
  });

  it("recognises assessment activities but not lectures", () => {
    expect(isAssessment({ activity: "ESoft Quiz" })).toBe(true);
    expect(isAssessment({ activity: "OSPE" })).toBe(true);
    expect(isAssessment({ activity: "lecture" })).toBe(false);
  });

  it("stores assessments per block and re-import replaces them", () => {
    const merged = mergeScheduleIntoStores(blocks, { terms: [], examDates: {}, lectures: [] });
    const blockId = merged.terms[0].blocks[0].id;

    expect(merged.assessments[blockId].length).toBeGreaterThan(0);
    expect(merged.summary.assessmentsSet).toBeGreaterThan(0);

    const again = mergeScheduleIntoStores(blocks, {
      terms: merged.terms,
      examDates: merged.examDates,
      lectures: merged.lectures,
      assessments: { [blockId]: [{ activity: "stale", date: "2026-01-01" }] },
    });
    expect(again.assessments[blockId].some((a) => a.activity === "stale")).toBe(false);
  });
});

describe("migrateLectureDates", () => {
  it("copies date onto lectureDate without touching anything else", () => {
    const { lectures, changed } = migrateLectureDates([
      { id: "a", blockId: "b1", date: "2026-08-12" },
      { id: "b", blockId: "b1", date: "2026-08-13", lectureDate: "2026-08-99" },
      { id: "c", blockId: "b1" },
    ]);

    expect(lectures[0].lectureDate).toBe("2026-08-12");
    expect(lectures[1].lectureDate).toBe("2026-08-99"); // never overwrite a real value
    expect(lectures[2].lectureDate).toBeUndefined();
    expect(changed.map((c) => c.id)).toEqual(["a"]);
  });

  it("is a no-op the second time", () => {
    const once = migrateLectureDates([{ id: "a", blockId: "b1", date: "2026-08-12" }]);
    const twice = migrateLectureDates(once.lectures);
    expect(twice.changed).toEqual([]);
  });
});
