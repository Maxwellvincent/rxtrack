import { describe, expect, it, vi } from "vitest";
import { updateQuestionBankMetadata } from "./questionBankMetadataEdits.js";

function makeStore(initial = {}) {
  let current = initial;
  return {
    read: vi.fn(() => current),
    writeAwait: vi.fn(async (_userId, next) => { current = next; }),
    write: vi.fn((_userId, next) => { current = next; }),
    withRecordedUpload: vi.fn((metadata, entry) => ({
      ...metadata,
      created: { ...entry },
    })),
    value: () => current,
  };
}

describe("updateQuestionBankMetadata", () => {
  it("waits for the durable name update and preserves existing metadata", async () => {
    const store = makeStore({ bank1: { filename: "Exam.pdf", blockId: "b1", weekNumber: 3 } });

    await updateQuestionBankMetadata("u1", { filename: "Exam.pdf" }, { displayName: "Exam 1" }, store);

    expect(store.writeAwait).toHaveBeenCalledWith("u1", {
      bank1: { filename: "Exam.pdf", blockId: "b1", weekNumber: 3, displayName: "Exam 1" },
    });
    expect(store.value().bank1.displayName).toBe("Exam 1");
  });

  it("persists the assigned date and derived week in the same metadata update", async () => {
    const store = makeStore({ bank1: { filename: "Exam.pdf", blockId: "b1", displayName: "Exam 1" } });

    await updateQuestionBankMetadata("u1", { filename: "Exam.pdf" }, { assignedDate: "2026-09-21", weekNumber: 4 }, store);

    expect(store.value().bank1).toMatchObject({
      displayName: "Exam 1",
      assignedDate: "2026-09-21",
      weekNumber: 4,
    });
  });

  it("restores the last confirmed local metadata and rejects when Firestore fails", async () => {
    const original = { bank1: { filename: "Exam.pdf", blockId: "b1", displayName: "Old name" } };
    const store = makeStore(original);
    const error = new Error("Firestore unavailable");
    store.writeAwait.mockRejectedValueOnce(error);

    await expect(updateQuestionBankMetadata("u1", { filename: "Exam.pdf" }, { displayName: "New name" }, store)).rejects.toBe(error);

    expect(store.write).toHaveBeenCalledWith("u1", original);
    expect(store.value()).toEqual(original);
  });

  it("creates metadata for a legacy bank before persisting an edit", async () => {
    const store = makeStore({});

    await updateQuestionBankMetadata("u1", { filename: "Legacy.pdf", blockId: "b1" }, { displayName: "Legacy quiz" }, store);

    expect(store.withRecordedUpload).toHaveBeenCalledWith({}, {
      filename: "Legacy.pdf",
      blockId: "b1",
      sourceKind: "school",
    });
    expect(store.value().created).toMatchObject({ filename: "Legacy.pdf", displayName: "Legacy quiz" });
  });
});
