import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "./testEnv.js";
import { get, key, save } from "./tutorSessions.js";

describe("tutor session checkpoints", () => {
  beforeEach(() => installDomStorage());

  it("persists a compacted checkpoint after a transient quota error", () => {
    const originalSetItem = window.Storage.prototype.setItem;
    const quotaError = new DOMException("Storage full", "QuotaExceededError");
    const setItem = vi.spyOn(window.Storage.prototype, "setItem")
      .mockImplementationOnce(() => { throw quotaError; })
      .mockImplementation(originalSetItem);
    const state = {
      lectureId: "lecture-1",
      status: "active",
      objectiveIds: ["o1"],
      completedObjectiveIds: [],
      turns: Array.from({ length: 24 }, (_, index) => ({
        objectiveId: "o1",
        response: `response-${index}-${"x".repeat(1000)}`,
        feedback: "feedback",
      })),
      learnerProfile: { confirmedAnchors: [], recentMisses: [], confidenceEvents: [], reasoningSkillEvidence: [] },
    };

    expect(save("user", state)).toBeTruthy();
    expect(setItem).toHaveBeenCalledTimes(2);
    const restored = get("user", "lecture-1");
    expect(restored.turns.length).toBe(6);
    expect(restored.turns.at(-1).response.length).toBeLessThan(1000);
    expect(restored.objectiveStartedIds).toEqual(["o1"]);
    expect(localStorage.getItem(`rxt:user:${key}`)).toBeTruthy();
  });

  it("returns an unsaved result instead of throwing when local storage remains full", () => {
    vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    expect(save("user", { lectureId: "lecture-1", turns: [] })).toBeNull();
  });
});
