import { describe, expect, it } from "vitest";
import { buildFocusPlan, completedLectureQuizIdsToday, computeSchedule, selectExamPrepTasks, suggestedDayMode } from "./Today.jsx";

describe("optimized daily routine", () => {
  it("keeps completed focus rows ahead of scheduler backfill", () => {
    expect(buildFocusPlan(["new-1", "new-2"], ["done-1", "done-2"])).toEqual(["done-1", "done-2"]);
    expect(buildFocusPlan(["remaining", "backfill"], ["done-1"])).toEqual(["done-1", "remaining"]);
  });

  it("recovers completed quizzes for today's progress after a reload", () => {
    expect(completedLectureQuizIdsToday({
      "lec-1__dm": { lectureId: "lec-1", sessions: [{ lectureId: "lec-1", sessionType: "lecture_quiz", at: "2026-09-29T14:00:00-04:00" }] },
      "lec-2__dm": { lectureId: "lec-2", sessions: [{ lectureId: "lec-2", sessionType: "lecture_quiz", at: "2026-09-28T14:00:00-04:00" }] },
    }, "2026-09-29")).toEqual(["lec-1"]);
  });

  it("suggests exam prep throughout the final three days", () => {
    expect(suggestedDayMode(3, "05:00")).toBe("exam");
    expect(suggestedDayMode(1, "05:00")).toBe("exam");
    expect(suggestedDayMode(0, "05:00")).toBe("exam");
    expect(suggestedDayMode(4, "05:00")).toBe("lecture");
  });

  it("balances struggling repair with unseen objective coverage in exam prep", () => {
    const task = (id, struggling, untested, urgency = 0) => ({ lec: { id }, struggling, untested, urgency });
    const selected = selectExamPrepTasks([
      task("repair", 9, 0, 90),
      task("coverage", 0, 14, 70),
      task("mixed", 3, 8, 80),
      task("future", 0, 30, 120),
    ].map((item) => item.lec.id === "future" ? { ...item, isFuture: true } : item));
    expect(selected.map((item) => item.lec.id)).toContain("repair");
    expect(selected.map((item) => item.lec.id)).toContain("coverage");
    expect(selected.find((item) => item.lec.id === "repair")?.matchReason).toBe("exam-repair");
    expect(selected.find((item) => item.lec.id === "coverage")?.matchReason).toBe("exam-coverage");
    expect(selected.map((item) => item.lec.id)).not.toContain("future");
  });

  it("builds a bounded application-and-repair routine for exam prep", () => {
    const blocks = computeSchedule("exam", "06:00", "08:00", 60);
    expect(blocks.some((block) => block.label.includes("Timed mixed questions"))).toBe(true);
    expect(blocks.some((block) => block.phase === "REPAIR")).toBe(true);
    expect(blocks.at(-1).label).toContain("protect sleep");
  });

  it("keeps 06:30 as the travel anchor when wake time moves later", () => {
    const blocks = computeSchedule("lecture", "06:00", "08:00", 60, {
      leaveHomeTime: "06:30", smallGroup: true, gymTime: "21:00",
    });
    expect(blocks.find((block) => block.label.includes("Travel to school"))).toMatchObject({ start: 390, end: 405 });
    expect(blocks.find((block) => block.label.includes("Anki — retention"))).toBeUndefined();
  });

  it("uses the no-small-group afternoon when selected", () => {
    const blocks = computeSchedule("lecture", "05:30", "08:00", 60, {
      leaveHomeTime: "06:30", smallGroup: false, gymTime: "21:00",
    });
    expect(blocks.some((block) => block.label.includes("Small group"))).toBe(false);
    expect(blocks.some((block) => block.label.includes("Additional questions"))).toBe(true);
  });

  it("organizes the routine into the learning sequence", () => {
    const phases = new Set(computeSchedule("lecture", "05:00", "08:00", 60, {
      leaveHomeTime: "06:30", smallGroup: true, gymTime: "21:00",
    }).map((block) => block.phase));
    for (const phase of ["RETAIN", "EXPOSE", "BUILD", "RETRIEVE", "APPLY", "REPAIR", "REMEDIATE", "PREPARE"]) {
      expect(phases.has(phase)).toBe(true);
    }
  });
});
