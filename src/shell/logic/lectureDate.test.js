import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase.js", () => ({ saveLectureToCloud: vi.fn() }));
const { updateLectureDate } = await import("./lectureDate.js");

function fakeStore(rows) {
  let data = rows;
  return {
    read: vi.fn(() => data),
    write: vi.fn((_userId, next) => { data = next; return next; }),
    value: () => data,
  };
}

describe("updateLectureDate", () => {
  it("saves updated metadata to cloud before updating the local mirror", async () => {
    const store = fakeStore([
      { id: "lec-1", blockId: "b1", lectureTitle: "Renal", lectureDate: "2026-09-16" },
      { id: "lec-2", blockId: "b1", lectureTitle: "Cardio" },
    ]);
    const save = vi.fn(async () => ({ saved: true }));

    await updateLectureDate("u1", "lec-1", "2026-09-17", { store, save });

    expect(save).toHaveBeenCalledWith("u1", expect.objectContaining({
      id: "lec-1", blockId: "b1", lectureDate: "2026-09-17",
    }));
    expect(save.mock.calls[0][1]).not.toHaveProperty("lectureTitle");
    expect(store.value()[0].lectureDate).toBe("2026-09-17");
    expect(store.value()[1].lectureTitle).toBe("Cardio");
  });

  it("does not claim a local save when the cloud write fails", async () => {
    const store = fakeStore([{ id: "lec-1", blockId: "b1", lectureDate: "2026-09-16" }]);
    const save = vi.fn(async () => ({ saved: false }));

    await expect(updateLectureDate("u1", "lec-1", "2026-09-17", { store, save })).rejects.toThrow(/Could not save/);
    expect(store.write).not.toHaveBeenCalled();
    expect(store.value()[0].lectureDate).toBe("2026-09-16");
  });

  it("supports clearing a date and local-only use", async () => {
    const store = fakeStore([{ id: "lec-1", blockId: "b1", lectureDate: "2026-09-16" }]);
    const save = vi.fn();

    await updateLectureDate(null, "lec-1", null, { store, save });

    expect(save).not.toHaveBeenCalled();
    expect(store.value()[0].lectureDate).toBeNull();
  });
});
