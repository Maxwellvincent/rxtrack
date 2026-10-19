import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("firebase/firestore", () => ({ doc: (_, ...parts) => parts.join("/"), runTransaction: (_, callback) => mocks.run(callback), serverTimestamp: () => "now" }));
vi.mock("../../firebase.js", () => ({ db: {} }));
vi.mock("../../stores/lectures.js", () => ({ read: mocks.read, writeCloudSaved: mocks.write }));
import { mergeMultipartLectures } from "./mergeMultipartLectures.js";
const rows = [1, 2].map(n => ({ id: `p${n}`, blockId: "NB", lectureType: "DLA", lectureNumber: 3, filename: `NB DLA 03 Pathways (${n}) - Before NB 09.pdf`, lectureTitle: "Before NB 09", sourceStoragePath: `pdf${n}` }));
let writes;
beforeEach(() => {
 vi.clearAllMocks(); writes = [];
 mocks.read.mockReturnValue(rows);
 mocks.run.mockImplementation(async callback => callback({
  get: async ref => ({ exists: () => true, data: () => ref.includes("objectives") ? { data: [{ id: "o", linkedLecId: "p2", attempts: [1] }] } : { data: rows[ref.endsWith("p1") ? 0 : 1], chunks: [{ markdown: ref.endsWith("p1") ? "first" : "second" }], atoms: [{ id: ref }] } }),
  set: (...args) => writes.push(args),
 }));
});
describe("atomic multipart repair", () => {
 it("saves both bodies and source paths, archives instead of deleting, and relinks objectives", async () => {
  const merged = await mergeMultipartLectures("u", rows);
  expect(merged.combinedParts).toBe(2);
  expect(writes[0][1].chunks.map(c => c.markdown).join(" ")).toContain("first");
  expect(writes[0][1].chunks.map(c => c.markdown).join(" ")).toContain("second");
  expect(merged.sourceFiles.map(f => f.storagePath)).toEqual(["pdf1", "pdf2"]);
  expect(writes[1][1].data).toEqual({ mergedInto: "p1" });
  expect(writes[2][1].data[0]).toMatchObject({ id: "o", linkedLecId: "p1", originalLectureId: "p2", attempts: [1] });
  expect(mocks.write).toHaveBeenCalledTimes(1);
 });
 it("does not hide any local lecture when the transaction fails", async () => {
  mocks.run.mockRejectedValue(new Error("offline"));
  await expect(mergeMultipartLectures("u", rows)).rejects.toThrow("offline");
  expect(mocks.write).not.toHaveBeenCalled();
 });
});
