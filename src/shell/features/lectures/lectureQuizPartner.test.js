import { describe, expect, it, vi } from "vitest";
import { earlierBlockLectures, lectureQuizPartner, objectivesByLinkedLecture } from "./lectureQuizPartner.js";

const lectures = [
  { id: "nb44", blockId: "b", lectureDate: "2026-11-10", lectureTitle: "NB 44 Spinal cord" },
  { id: "nb45", blockId: "b", lectureDate: "2026-11-11", lectureTitle: "NB 45 Brainstem" },
  { id: "nb46", blockId: "b", lectureDate: "2026-11-12", lectureTitle: "NB 46 Vasculature" },
  { id: "x", blockId: "other", lectureDate: "2026-11-01" },
];
const blockObjectives = [
  { id: "o44", linkedLecId: "nb44" }, { id: "o45", linkedLecId: "nb45" }, { id: "o46", linkedLecId: "nb46" }, { id: "ox", linkedLecId: "x" },
];

describe("lecture quiz partner", () => {
  it("only offers earlier lectures from the same block that have objectives", () => {
    const grouped = objectivesByLinkedLecture(blockObjectives);
    expect(earlierBlockLectures(lectures[1], lectures, grouped).map(l => l.id)).toEqual(["nb44"]);
    expect(earlierBlockLectures(lectures[0], lectures, grouped)).toEqual([]);
  });

  it("waits for the first pass, then loads the chosen partner's text and objectives", async () => {
    const loadEvidence = vi.fn(async lecture => ({ lectureText: `Text of ${lecture.id}` }));
    const base = { userId: "u", lecture: lectures[2], lectures, blockObjectives };
    expect(await lectureQuizPartner({ ...base, firstPassComplete: false }, { loadEvidence })).toBe(null);
    const partner = await lectureQuizPartner({ ...base, firstPassComplete: true }, { loadEvidence });
    expect(partner).toMatchObject({ id: "nb45", title: "NB 45 Brainstem", text: "Text of nb45" });
    expect(partner.objectives.map(o => o.id)).toEqual(["o45"]);
  });

  it("returns no partner when the partner's text cannot be loaded", async () => {
    const partner = await lectureQuizPartner({ userId: "u", lecture: lectures[2], lectures, blockObjectives, firstPassComplete: true }, { loadEvidence: async () => { throw new Error("offline"); } });
    expect(partner).toBe(null);
  });
});
