import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./aiClient", () => ({
  callAI: vi.fn().mockResolvedValue('{"concept":"radial nerve injury","description":"","angle":"anatomy"}'),
}));
vi.mock("./supabase", () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  scheduleDebouncedCloudPush: vi.fn(),
}));
vi.mock("./stores/weakConcepts.js", () => ({
  read: vi.fn().mockReturnValue({}),
  write: vi.fn(),
}));

import * as weakConceptsStore from "./stores/weakConcepts.js";
import { recordWrongAnswer, backfillObjectiveLinks } from "./weakConcepts.js";

describe("recordWrongAnswer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    weakConceptsStore.read.mockReturnValue({});
  });

  it("reads and writes the store under the real userId, not null", async () => {
    await recordWrongAnswer({
      userId: "user-123",
      blockId: "block-1",
      question: "Which nerve is injured?",
      wrongAnswer: "Ulnar",
      correctAnswer: "Radial",
      linkedLecId: "lec-1",
      lectureLabel: "Upper limb",
    });
    expect(weakConceptsStore.read).toHaveBeenCalledWith("user-123");
    expect(weakConceptsStore.write).toHaveBeenCalledWith("user-123", expect.any(Object));
  });

  it("still no-ops gracefully without a blockId", async () => {
    await recordWrongAnswer({ userId: "user-123", blockId: null, question: "x", wrongAnswer: "a", correctAnswer: "b" });
    expect(weakConceptsStore.write).not.toHaveBeenCalled();
  });
});

describe("backfillObjectiveLinks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads and writes under the real userId, not null", () => {
    weakConceptsStore.read.mockReturnValue({
      "block-1": [{ id: "c1", concept: "radial nerve injury", linkedLecIds: ["lec-1"], objectiveIds: [] }],
    });
    backfillObjectiveLinks(
      [{ id: "obj-1", linkedLecId: "lec-1", objective: "Describe radial nerve injury presentation" }],
      "user-123"
    );
    expect(weakConceptsStore.read).toHaveBeenCalledWith("user-123");
    expect(weakConceptsStore.write).toHaveBeenCalledWith("user-123", expect.any(Object));
  });
});
