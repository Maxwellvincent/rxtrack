import { beforeEach, describe, expect, it } from "vitest";
import * as cloud from "./cloudBase.js";
import { recordEvidence, read as readEvidence } from "./learnerEvidence.js";
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

  it("excludes and restores source-contested evidence without losing attempts", () => {
    const user = "source-review-user";
    const question = { id: "imported-1", lectureId: "lecture-1" };
    recordEvidence(user, { questionKey: question.id, objectiveIds: ["objective-1"], correct: false, misconception: "landmine", at: 10 });
    recordEvidence(user, { questionKey: "valid-2", objectiveIds: ["objective-1"], correct: true, at: 20 });
    ratings.rateQuestion(user, question, { sourceIssue: "incorrect-key", sourceNote: "Source says otherwise" });
    expect(readEvidence(user).total).toBe(1);
    expect(readEvidence(user).objectives["objective-1"]).toMatchObject({ attempts: 1, correct: 1, landmines: 0 });
    expect(readEvidence(user).evidenceJournal).toHaveLength(2);
    recordEvidence(user, { questionKey: "valid-3", objectiveIds: ["objective-1"], correct: true, at: 30 });
    expect(readEvidence(user).total).toBe(2);
    ratings.rateQuestion(user, question, { sourceIssue: null });
    expect(readEvidence(user).total).toBe(3);
    expect(readEvidence(user).objectives["objective-1"]).toMatchObject({ attempts: 3, correct: 2, landmines: 1 });
  });

  it("does not rate non-versioned school questions", () => {
    expect(ratings.rateQuestion("rating-user-2", { id: "school" }, { fair: true })).toBeNull();
  });
});
