import { describe, expect, it, vi } from "vitest";
import { blockBackup, deleteBlock, planBlockDeletion, termsWithoutBlock } from "./deleteBlock.js";

const terms = [{ id: "t1", blocks: [{ id: "ftm1", name: "FTM 1" }, { id: "ftm2", name: "FTM 2" }] }];
const lectures = [{ id: "a", blockId: "ftm1" }, { id: "b", blockId: "ftm2" }, { id: "c", blockId: "ftm2" }];
const objectives = { ftm1: [{ id: "o1" }], ftm2: { imported: [{ id: "o2", attempts: 3 }], extracted: [{ id: "o3" }] } };

function fakeStores() {
  const state = { terms, lectures, objectives };
  return {
    state,
    terms: { read: () => state.terms, writeAwait: vi.fn(async (_u, next) => { state.terms = next; }) },
    lectures: { read: () => state.lectures, write: vi.fn((_u, next) => { state.lectures = next; }) },
    objectives: { read: () => state.objectives, removeBlock: vi.fn(async (_u, id) => { const { [id]: _gone, ...rest } = state.objectives; state.objectives = rest; }) },
  };
}

describe("delete block", () => {
  it("plans what goes: the block's lectures and objectives, with practised objectives counted", () => {
    expect(planBlockDeletion({ blockId: "ftm2", terms, lectures, objectives })).toMatchObject({ block: { name: "FTM 2" }, termId: "t1", lectureIds: ["b", "c"], objectiveCount: 2, objectivesWithAttempts: 1 });
    expect(termsWithoutBlock(terms, "ftm2")[0].blocks.map(b => b.id)).toEqual(["ftm1"]);
  });

  it("deletes lectures, objectives and the term entry, leaving other blocks alone", async () => {
    const stores = fakeStores();
    const deleteLecture = vi.fn(async () => true);
    const tombstone = vi.fn();
    await deleteBlock({ userId: "u", blockId: "ftm2" }, { ...stores, deleteLecture, tombstone });
    expect(tombstone.mock.calls.map(call => call[0])).toEqual(["b", "c"]);
    expect(deleteLecture.mock.calls.map(call => call[1])).toEqual(["b", "c"]);
    expect(stores.state.lectures.map(l => l.id)).toEqual(["a"]);
    expect(Object.keys(stores.state.objectives)).toEqual(["ftm1"]);
    expect(stores.state.terms[0].blocks.map(b => b.id)).toEqual(["ftm1"]);
  });

  it("keeps the block (so it can be retried) when a lecture fails to delete", async () => {
    const stores = fakeStores();
    const deleteLecture = vi.fn(async (_u, id) => { if (id === "c") throw new Error("offline"); });
    await expect(deleteBlock({ userId: "u", blockId: "ftm2" }, { ...stores, deleteLecture, tombstone: vi.fn() })).rejects.toThrow(/could not be deleted/);
    expect(stores.state.lectures.map(l => l.id)).toEqual(["a", "c"]);
    expect(stores.objectives.removeBlock).not.toHaveBeenCalled();
    expect(stores.state.terms[0].blocks).toHaveLength(2);
  });

  it("backs up the lectures with their text and the objectives", async () => {
    const backup = await blockBackup({ userId: "u", blockId: "ftm2", terms, lectures, objectives }, { fetchContent: async (_u, id) => ({ chunks: [{ markdown: `text ${id}` }], atoms: [], images: [] }) });
    expect(backup.block.id).toBe("ftm2");
    expect(backup.lectures.map(l => l.chunks[0].markdown)).toEqual(["text b", "text c"]);
    expect(backup.objectives.imported[0].id).toBe("o2");
  });
});
