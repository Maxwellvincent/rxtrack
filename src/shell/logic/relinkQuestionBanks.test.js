import { describe, expect, it, vi } from "vitest";
import { relinkAllQuestionBanks, routeUnlinkedQuestions } from "./relinkQuestionBanks.js";

const lecture = (id, blockId, title, text) => ({ id, blockId, termId: "t2", lectureTitle: title, lectureDate: "2026-11-01", chunks: [{ text }] });
const lectures = [
  lecture("n1", "neuro", "Cerebellum", "The cerebellum coordinates movement. Cerebellar lesions cause ataxia, intention tremor and dysmetria on the same side."),
  lecture("g1", "gi", "Midgut vessels", "The superior mesenteric artery supplies the jejunum, ileum and midgut. Superior mesenteric artery occlusion causes intestinal ischemia of the jejunum."),
];
const q = (id, stem, answer, extra = {}) => ({ id, stem, correct: "A", choices: { A: answer, B: "Other" }, ...extra });

describe("routeUnlinkedQuestions", () => {
  it("routes each unlinked question to the block that matches its text", () => {
    const routes = routeUnlinkedQuestions({ homeBlockId: "neuro", lectures, questions: [
      q("q1", "Which vessel supplies the jejunum in this patient with intestinal ischemia of the midgut?", "Superior mesenteric artery"),
      q("q2", "Which finding follows a cerebellar lesion with ataxia?", "Intention tremor"),
      q("q3", "Already placed jejunum superior mesenteric", "Superior mesenteric artery", { lectureId: "x" }),
    ] });
    expect(Object.fromEntries([...routes].map(([block, keys]) => [block, [...keys]]))).toEqual({ gi: ["q1"], neuro: ["q2"] });
  });
});

describe("relinkAllQuestionBanks", () => {
  it("checks home questions at home and routed questions in their own block", async () => {
    let banks = { bank: [
      q("q1", "Which vessel supplies the jejunum in this patient with intestinal ischemia of the midgut?", "Superior mesenteric artery"),
      q("q2", "Which finding follows a cerebellar lesion with ataxia and dysmetria?", "Intention tremor"),
    ] };
    const resume = vi.fn(async args => {
      if (args.onlyKeys) banks = { bank: banks.bank.map(item => args.onlyKeys.has(item.id) ? { ...item, lectureId: "g1" } : item) };
      return { status: "complete", linked: 0, lectureLinked: banks.bank.filter(item => item.lectureId).length };
    });
    const results = await relinkAllQuestionBanks({ userId: "u" }, {
      readBanks: () => banks, readMeta: () => ({ m: { filename: "bank", blockId: "neuro", sourceKind: "school" } }),
      readLectures: () => lectures, readObjectives: () => ({ gi: [{ id: "o" }] }), fetchLectureContent: async () => null, resume,
    });
    expect(resume).toHaveBeenCalledTimes(2);
    const first = resume.mock.calls[0][0];
    expect(first.scope.homeBlockId).toBe("neuro");
    expect([...first.onlyKeys]).toEqual(["q2"]);
    expect(first.crossBlock).toBeUndefined();
    const second = resume.mock.calls[1][0];
    expect(second.crossBlock).toBe(true);
    expect(second.scope.homeBlockId).toBe("gi");
    expect([...second.onlyKeys]).toEqual(["q1"]);
    expect(second.lectures.map(item => item.id)).toEqual(["g1"]);
    expect(second.objectives).toEqual([{ id: "o" }]);
    expect(results[0].crossBlock).toEqual({ gi: { tried: 1, linked: 1 } });
  });
});
