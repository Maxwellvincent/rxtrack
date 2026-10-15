import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "../../stores/testEnv.js";
import * as lectures from "../../stores/lectures.js";
vi.mock("../../supabase.js", () => ({ saveLectureToCloud: vi.fn() }));
const { updateLectureDate } = await import("./lectureDate.js");
const { renameLecture } = await import("../features/lectures/RenameLecture.jsx");

beforeEach(() => installDomStorage());
afterEach(() => { vi.restoreAllMocks(); window.dispatchEvent(new StorageEvent("storage", { key: null })); });

it("keeps a cloud-saved rename and date edit usable with a full legacy lecture cache", async () => {
  const rows = [{ id: "l1", blockId: "b1", lectureTitle: "Old", lectureDate: "2026-10-14" }, { id: "unsynced", fullText: "local-only text" }];
  localStorage.setItem("rxt-lec-meta", JSON.stringify(rows));
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  const save = vi.fn(async () => ({ saved: true }));
  await expect(renameLecture("u", "l1", "New", { save })).resolves.toBe("New");
  await expect(updateLectureDate("u", "l1", "2026-10-15", { save })).resolves.toMatchObject({ lectureTitle: "New", lectureDate: "2026-10-15" });
  expect(lectures.read("u")[1]).toEqual(rows[1]);
  expect(JSON.parse(localStorage.getItem("rxt-lec-meta"))).toEqual(rows);
  expect(localStorage.getItem("rxt:u:rxt-lec-meta")).toBeNull();
});

it("does not change the legacy list if the cloud save fails", async () => {
  const rows = [{ id: "l1", lectureTitle: "Old" }];
  localStorage.setItem("rxt-lec-meta", JSON.stringify(rows));
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  await expect(renameLecture("u", "l1", "New", { save: async () => ({ saved: false }) })).rejects.toThrow(/save/);
  expect(lectures.read("u")).toEqual(rows);
});
