import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { buildResetFocusPlan, markTodayLectureComplete, readChecked } from "./todayProgress.js";

describe("Today durable completion", () => {
  beforeEach(() => installDomStorage());

  it("persists a completed lecture quiz while Today is unmounted", () => {
    const now = new Date(2026, 8, 29, 16, 0, 0);
    markTodayLectureComplete("dm", "lec-4", now);
    expect([...readChecked("dm", now)]).toEqual(["lec-4"]);
  });

  it("builds a fresh reset set from unchecked unique recommendations only", () => {
    expect(buildResetFocusPlan(["done", "new-1", "new-1", "new-2", "new-3"], ["done"], 2))
      .toEqual(["new-1", "new-2"]);
  });
});
