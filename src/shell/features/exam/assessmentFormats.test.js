import { describe, expect, it } from "vitest";
import { assessmentFormat, crossLectureOptions, defaultScopeFor, scopeAllowed } from "./assessmentFormats.js";

describe("school assessment formats", () => {
  it("sets the cross-lecture share and partner window per format", () => {
    expect(crossLectureOptions("homework", [])).toMatchObject({ crossLectureShare: 0 });
    expect(crossLectureOptions("imcq", [{ lectureId: "a" }])).toEqual({ crossLectureShare: 0.4, crossLectureWindow: "same-week", crossLecturePartnerIds: ["a"] });
    expect(crossLectureOptions("esoft", [])).toMatchObject({ crossLectureShare: 0.5, crossLectureWindow: "scope" });
    expect(crossLectureOptions(null, [])).toMatchObject({ crossLectureShare: 0.25, crossLectureWindow: "same-week" });
    expect(assessmentFormat("bogus").id).toBe("custom");
  });

  it("starts each format on a fitting scope and drops to custom when the scope contradicts it", () => {
    expect(defaultScopeFor("imcq")).toBe("current-week");
    expect(defaultScopeFor("esoft")).toBe("past-two-weeks");
    expect(defaultScopeFor("homework", [{ lectureId: "old", lectureDate: "2026-11-01" }, { lectureId: "new", lectureDate: "2026-11-20" }])).toBe("lecture:new");
    expect(scopeAllowed("homework", "lecture:new")).toBe(true);
    expect(scopeAllowed("homework", "current-week")).toBe(false);
    expect(scopeAllowed("imcq", "12")).toBe(true);
    expect(scopeAllowed("esoft", "date-range:2026-11-01:2026-11-20")).toBe(true);
    expect(scopeAllowed("esoft", "lecture:x")).toBe(false);
  });
});
