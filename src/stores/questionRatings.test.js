import { beforeEach, describe, expect, it } from "vitest";
import * as cloud from "./cloudBase.js";
import * as ratings from "./questionRatings.js";

describe("question generator ratings", () => {
  beforeEach(() => cloud.clearCloudCache?.());

  it("stores one editable rating per question and compares completed ratings", () => {
    const q1 = { id: "q1", stem: "One", generationVersion: "v1" };
    const q2 = { id: "q2", stem: "Two", generationVersion: "v2" };
    ratings.rateQuestion("rating-user", q1, { fair: true });
    ratings.rateQuestion("rating-user", q1, { examStyle: false, issue: "weak-vignette" });
    ratings.rateQuestion("rating-user", q2, { fair: true, examStyle: true });
    expect(ratings.ratingFor("rating-user", q1)).toMatchObject({ fair: true, examStyle: false, issue: "weak-vignette" });
    expect(ratings.comparison("rating-user")).toMatchObject({
      v1: { count: 1, fairPercent: 100, examStylePercent: 0, issuePercent: 100 },
      v2: { count: 1, fairPercent: 100, examStylePercent: 100, issuePercent: 0 },
    });
  });

  it("does not rate non-versioned school questions", () => {
    expect(ratings.rateQuestion("rating-user-2", { id: "school" }, { fair: true })).toBeNull();
  });
});
