import { describe, expect, it } from "vitest";
import { buildLectureWeeks, rowMatchesWeek } from "./lectureWeeks.js";

describe("lecture week catalog", () => {
  const rows = [
    { lectureId: "fri", availableDate: new Date(2026, 8, 4) },
    { lectureId: "mon", availableDate: new Date(2026, 8, 7) },
    { lectureId: "sat", availableDate: new Date(2026, 8, 5) },
    { lectureId: "unknown", availableDate: null },
  ];

  it("groups dates into chronological Monday–Friday school weeks and retains undated lectures", () => {
    expect(buildLectureWeeks(rows)).toEqual([
      { key: "week:2026-09-04", fridayKey: "2026-09-04", label: "Week 1", range: "Aug 31–Sep 4", count: 2 },
      { key: "week:2026-09-11", fridayKey: "2026-09-11", label: "Week 2", range: "Sep 7–11", count: 1 },
      { key: "unscheduled", label: "Unscheduled", count: 1 },
    ]);
  });

  it("matches a selected week without pulling in adjacent weeks", () => {
    expect(rows.filter((row) => rowMatchesWeek(row, "week:2026-09-04")).map((row) => row.lectureId)).toEqual(["fri", "sat"]);
    expect(rows.filter((row) => rowMatchesWeek(row, "unscheduled")).map((row) => row.lectureId)).toEqual(["unknown"]);
    expect(rows.filter((row) => rowMatchesWeek(row, "all"))).toHaveLength(4);
  });
});
