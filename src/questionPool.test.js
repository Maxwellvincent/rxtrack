import { describe, it, expect } from "vitest";
import { questionPoolKey, isValidPoolQuestion } from "./questionPool.js";
const source = { blockId: "b", lectureId: "l", difficulty: "medium", lecture: { content: "Original source" }, objectives: [{ id: "o", text: "Explain feedback", status: "new" }], atoms: [], exemplars: [] };
describe("question pool freshness", () => {
  it("invalidates on source, difficulty, objective or exemplar changes", async () => {
    const original = await questionPoolKey(source);
    for (const change of [{ difficulty: "expert" }, { lecture: { content: "New source" } }, { objectives: [{ id: "o", text: "Changed objective" }] }, { exemplars: [{ stem: "New school example" }] }]) {
      expect(await questionPoolKey({ ...source, ...change })).not.toBe(original);
    }
    expect(await questionPoolKey({ ...source, objectives: [{ ...source.objectives[0], status: "mastered" }] })).toBe(original);
  });
  it("requires a keyed answer and renderable choices", () => {
    const q = { stem: "Which?", choices: { A: "one", B: "two" }, correct: "A" };
    expect(isValidPoolQuestion(q)).toBe(true);
    expect(isValidPoolQuestion({ ...q, correct: "C" })).toBe(false);
    expect(isValidPoolQuestion({ ...q, stem: "" })).toBe(false);
    expect(isValidPoolQuestion({ ...q, choices: { A: {} } })).toBe(false);
  });
});
