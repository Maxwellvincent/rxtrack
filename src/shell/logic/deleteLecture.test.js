import { describe, expect, it, vi } from "vitest";
import { deleteLectureFully, deleteLecturesFully } from "./deleteLecture.js";

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

describe("deleteLecturesFully", () => {
  it("deletes the selected set with one objectives write and preserves imported objectives as unlinked", async () => {
    let lecturesValue = [{ id: "keep" }, { id: "drop-1" }, { id: "drop-2" }];
    let objectivesValue = { b1: {
      imported: [{ id: "i", linkedLecId: "drop-1", sourceFile: "drop-1" }],
      extracted: [{ id: "e1", linkedLecId: "drop-1" }, { id: "e2", linkedLecId: "drop-2" }, { id: "k", linkedLecId: "keep" }],
    } };
    const deleteCloud = vi.fn();
    const tombstone = vi.fn();
    const saveObjectives = vi.fn();
    const result = await deleteLecturesFully({ userId: "u1", blockId: "b1", lectures: [{ id: "drop-1" }, { id: "drop-2" }] }, {
      lectures: { read: () => lecturesValue, write: (_u, value) => { lecturesValue = value; } },
      objectives: { read: () => objectivesValue, write: (_u, value) => { objectivesValue = value; } },
      deleteCloud,
      tombstone,
      saveObjectives,
    });

    expect(result).toMatchObject({ deletedIds: ["drop-1", "drop-2"], failures: [], objectivesSaved: true });
    expect(lecturesValue.map((lecture) => lecture.id)).toEqual(["keep"]);
    expect(objectivesValue.b1.imported[0]).toMatchObject({ linkedLecId: null, sourceFile: null });
    expect(objectivesValue.b1.extracted.map((objective) => objective.id)).toEqual(["k"]);
    expect(deleteCloud).toHaveBeenCalledTimes(2);
    expect(saveObjectives).toHaveBeenCalledTimes(1);
    expect(tombstone).toHaveBeenCalledTimes(2);
  });

  it("continues after a failed cloud delete and keeps that lecture locally", async () => {
    let lecturesValue = [{ id: "fail" }, { id: "drop" }];
    const deleteCloud = vi.fn(async (_userId, id) => { if (id === "fail") throw new Error("offline"); });
    const result = await deleteLecturesFully({ userId: "u1", blockId: "b1", lectures: [{ id: "fail" }, { id: "drop" }] }, {
      lectures: { read: () => lecturesValue, write: (_u, value) => { lecturesValue = value; } },
      objectives: { read: () => ({}), write: vi.fn() },
      deleteCloud,
      tombstone: vi.fn(),
      saveObjectives: vi.fn(),
    });

    expect(result.deletedIds).toEqual(["drop"]);
    expect(result.failures.map((failure) => failure.id)).toEqual(["fail"]);
    expect(lecturesValue.map((lecture) => lecture.id)).toEqual(["fail"]);
  });
});
