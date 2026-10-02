import { describe, expect, it } from "vitest";
import { hasLectureMetadata } from "./lectureCloudRecord.js";

describe("hasLectureMetadata", () => {
  it("accepts real lecture documents", () => {
    expect(hasLectureMetadata({ data: { lectureTitle: "NB 02 General Morphology" } })).toBe(true);
  });

  it("rejects enrichment-only documents so they cannot appear as ghost lectures", () => {
    expect(hasLectureMetadata({ atoms: [{ term: "CNS" }] })).toBe(false);
    expect(hasLectureMetadata({ data: { id: "lec-2" }, atoms: [] })).toBe(false);
  });
});
