import { describe, expect, it } from "vitest";
import { filterLecturesByScope, fridayWeekKey } from "./weekScope.js";

const lectures = [
  { id: "old", lectureDate: "2026-09-04", weekNumber: 1 },
  { id: "current", lectureDate: "2026-09-10", weekNumber: 2 },
  { id: "future", lectureDate: "2026-09-19", weekNumber: 3 },
];

describe("Friday study-week scopes", () => {
  it("treats Monday through Friday as one week and keeps the weekend before Monday", () => {
    expect(fridayWeekKey("2026-09-05")).toBe("2026-09-04");
    expect(fridayWeekKey("2026-09-11")).toBe("2026-09-11");
    expect(fridayWeekKey("2026-09-12")).toBe("2026-09-11");
    expect(fridayWeekKey("2026-09-14")).toBe("2026-09-18");
    expect(fridayWeekKey("2026-09-15")).toBe("2026-09-18");
  });

  it("filters current, prior, and future content using the Friday cutoff", () => {
    const now = new Date(2026, 8, 10);
    expect(filterLecturesByScope(lectures, "current-week", now).map((item) => item.id)).toEqual(["current"]);
    expect(filterLecturesByScope(lectures, "past-two-weeks", now).map((item) => item.id)).toEqual(["old", "current"]);
    expect(filterLecturesByScope(lectures, "block-so-far", now).map((item) => item.id)).toEqual(["old", "current"]);
  });
});
