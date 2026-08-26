import { describe, expect, it, vi } from "vitest";
import { deleteLectureFully } from "./deleteLecture.js";

describe("deleteLectureFully", () => {
  it("deletes the row and extracted objectives while unlinking imported objectives", async () => {
    let lecturesValue = [{ id: "keep" }, { id: "drop" }];
    let objectivesValue = {
      b1: {
        imported: [{ id: "i", linkedLecId: "drop", sourceFile: "drop" }],
        extracted: [{ id: "e", linkedLecId: "drop" }, { id: "k", linkedLecId: "keep" }],
      },
    };
    const deleteCloud = vi.fn();
    const tombstone = vi.fn();
    await deleteLectureFully({ userId: "u1", lectureId: "drop", blockId: "b1" }, {
      lectures: { read: () => lecturesValue, write: (_u, v) => { lecturesValue = v; } },
      objectives: { read: () => objectivesValue, write: (_u, v) => { objectivesValue = v; } },
      deleteCloud,
      tombstone,
      saveObjectives: vi.fn(),
    });
    expect(lecturesValue.map((l) => l.id)).toEqual(["keep"]);
    expect(objectivesValue.b1.imported[0].linkedLecId).toBeNull();
    expect(objectivesValue.b1.extracted.map((o) => o.id)).toEqual(["k"]);
    expect(deleteCloud).toHaveBeenCalledWith("u1", "drop");
    expect(tombstone).toHaveBeenCalledWith("drop");
  });
});
