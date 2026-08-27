import { describe, it, expect, vi } from "vitest";
import { renameLecture } from "./RenameLecture.jsx";

describe("renameLecture", () => {
  it("preserves IDs and study data and sends only metadata to cloud", async () => {
    const row = { id: "l1", blockId: "b", termId: "t", lectureTitle: "Old", atoms: [{ term: "A" }], chunks: [{ text: "body" }] };
    const store = { read: () => [row], write: vi.fn() };
    const save = vi.fn(async () => ({ saved: true }));
    await renameLecture("u", "l1", " New name ", { store, save });
    expect(save).toHaveBeenCalledWith("u", { id: "l1", blockId: "b", termId: "t", lectureTitle: "New name", title: "New name" });
    expect(store.write.mock.calls[0][1][0]).toEqual({ ...row, lectureTitle: "New name", title: "New name" });
  });
  it("does not apply a failed rename locally", async () => {
    const store = { read: () => [{ id: "l1" }], write: vi.fn() };
    await expect(renameLecture("u", "l1", "New", { store, save: async () => ({ saved: false }) })).rejects.toThrow(/save/);
    expect(store.write).not.toHaveBeenCalled();
    await expect(renameLecture("u", "l1", " ", { store })).rejects.toThrow(/name/);
  });
});
