import { afterEach, expect, it } from "vitest";
import { studyDayDate, studyDayMinutes, studyDayKey, studyDayRange, nextStudyDayDelay, setStudyDayUser } from "./studyDay.js";
import { markTodayLectureComplete, readChecked } from "./shell/features/today/todayProgress.js";
import { installDomStorage } from "./stores/testEnv.js";
import { appendActivity } from "./shell/logic/completionLog.js";
import { questionProgress } from "./shell/features/exam/questionProgress.js";
import { dayKey, reviewDayKey } from "./engine/modelRetrieval.js";
const owner = "KX9K9IK4DgU0dBoAD6pj6Q4CEgr1";
afterEach(() => setStudyDayUser(null));
it("rolls this account at 4am across months and years without changing other accounts", () => {
  const early = new Date(2027, 0, 1, 3, 59, 59);
  expect(studyDayKey(early, owner)).toBe("2026-12-31");
  expect(studyDayKey(new Date(2027, 0, 1, 4), owner)).toBe("2027-01-01");
  expect(studyDayKey(early, "another-user")).toBe("2027-01-01");
  expect(nextStudyDayDelay(early, owner)).toBe(2000);
  expect(studyDayDate(early, owner).getHours()).toBe(3);
  expect(studyDayMinutes(early, owner)).toBe(1679);
});
it("preserves checkmarks, activity dates and retrieval budget after midnight until 4am", () => {
  installDomStorage(); setStudyDayUser(owner);
  const evening = new Date(2026, 9, 15, 23), early = new Date(2026, 9, 16, 2);
  markTodayLectureComplete("nb", "l10", evening);
  expect(readChecked("nb", early).has("l10")).toBe(true);
  expect(readChecked("nb", new Date(2026, 9, 16, 4)).has("l10")).toBe(false);
  expect(dayKey(evening)).toBe(dayKey(early));
  expect(reviewDayKey({ at: early.getTime(), day: "2026-10-16" })).toBe(dayKey(evening));
  const result = appendActivity({}, { lectureId: "l10", blockId: "nb", activityType: "review", confidenceRating: "good", now: early, id: "event" });
  expect(JSON.stringify(result)).toContain("2026-10-15");
});
it("counts daily answers through 3:59am but excludes the next study day", () => {
  const early = new Date(2026, 9, 16, 2);
  const answers = [new Date(2026, 9, 15, 5), early, new Date(2026, 9, 16, 4)].map((date, i) => ({ ts: date.getTime(), concept: `c${i}`, correct: true }));
  expect(questionProgress(answers, [], studyDayRange(early, owner)).gradedAnswered).toBe(2);
});
