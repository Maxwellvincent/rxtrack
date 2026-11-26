import { describe, expect, it, vi } from "vitest";
import { GENERATED_TARGET, storedGeneratedForLectures, topUpCategoryQuestions, topUpObjectives } from "./reportTargetTopUp.js";

const q = (stem, extra = {}) => ({ stem, choices: { A: "x", B: "y" }, correct: "A", ...extra });

describe("storedGeneratedForLectures", () => {
  it("keeps unseen valid questions and tags them as generated store questions", () => {
    const byLecture = { l1: [q("Seen one", { seen: true }), q("Fresh one"), { stem: "broken" }], l2: [q("Other", { questionId: "keep" })] };
    const out = storedGeneratedForLectures("u", ["l1", "l2", "l1"], {
      questionsForLecture: (_u, id) => byLecture[id], isQuestionUnseen: question => !question.seen,
    });
    expect(out.map(question => question.stem)).toEqual(["Fresh one", "Other"]);
    expect(out[0]).toMatchObject({ lectureId: "l1", sourceKind: "generated", generatedStore: true, questionId: "gen:l1:fresh one" });
    expect(out[1].questionId).toBe("keep");
  });
});

describe("topUpObjectives", () => {
  it("prefers the category's objectives and falls back to the lecture's", () => {
    const all = [{ id: "a" }, { id: "b" }];
    expect(topUpObjectives(all, ["b"])).toEqual([{ id: "b" }]);
    expect(topUpObjectives(all, ["z"])).toEqual(all);
  });
});

describe("topUpCategoryQuestions", () => {
  const target = { broad: false, lectureIds: ["l1", "l2"], objectiveIds: ["o1"], keywords: ["thyroid"] };
  const baseDeps = (prepare) => ({
    lectures: [{ id: "l1", blockId: "b", lectureTitle: "Thyroid" }, { id: "l2", blockId: "b", lectureTitle: "Adrenal" }, { id: "l3", blockId: "b" }],
    objectivesByBlock: { b: [{ id: "o1", linkedLecId: "l1" }, { id: "o2", linkedLecId: "l2" }] },
    banks: {}, meta: {}, sourceUse: null,
    quizLaunch: { prepareObjectiveQuiz: prepare, selectExemplarsForBlock: () => [] },
    fetchLectureContent: async () => ({ chunks: [] }), preparationDeps: {}, ensureObjectiveParts: async () => ({}),
    questionsForAllLectures: () => [q("Old stem")], addQuestions: vi.fn(),
  });

  it("does nothing when stocked, broad, or unmapped", async () => {
    const prepare = vi.fn();
    expect(await topUpCategoryQuestions({ userId: "u", target, have: GENERATED_TARGET }, baseDeps(prepare))).toEqual({ added: 0, errors: [] });
    expect(await topUpCategoryQuestions({ userId: "u", target: { ...target, broad: true } }, baseDeps(prepare))).toEqual({ added: 0, errors: [] });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("splits the shortfall over the first two lectures and saves accepted questions", async () => {
    const prepare = vi.fn(async (args, deps) => { deps.onAccepted(Array.from({ length: args.questionCount }, (_, i) => q(`${args.lectureIdHint}-${i}`))); });
    const deps = baseDeps(prepare);
    const result = await topUpCategoryQuestions({ userId: "u", target, have: 2 }, deps);
    expect(result).toEqual({ added: 6, errors: [] });
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[0][0]).toMatchObject({ lectureIdHint: "l1", questionCount: 3, objectives: [{ id: "o1", linkedLecId: "l1" }], avoidStems: ["Old stem"] });
    expect(prepare.mock.calls[1][0]).toMatchObject({ lectureIdHint: "l2", questionCount: 3, objectives: [{ id: "o2", linkedLecId: "l2" }] });
    expect(deps.addQuestions).toHaveBeenCalledWith("u", "l1", expect.any(Array));
  });

  it("reports a failing lecture and keeps going", async () => {
    const prepare = vi.fn(async (args, deps) => { if (args.lectureIdHint === "l1") throw new Error("timeout"); deps.onAccepted([q("ok")]); });
    const result = await topUpCategoryQuestions({ userId: "u", target, have: 6 }, baseDeps(prepare));
    expect(result).toEqual({ added: 1, errors: ["Thyroid: timeout"] });
  });
});
