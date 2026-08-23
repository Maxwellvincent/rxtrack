import { beforeEach, describe, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as generatedQuestions from "./generatedQuestions.js";

describe("generatedQuestions store — addHighlight", () => {
  beforeEach(() => installDomStorage());

  const q = { stem: "A 45-year-old man presents with polyuria?", choices: { A: "a", B: "b" }, correct: "A" };

  it("attaches a highlighted phrase to the matching question by stem", () => {
    generatedQuestions.addQuestions("u1", "lecA", [q]);
    generatedQuestions.addHighlight("u1", "lecA", q.stem, "polyuria");
    const [saved] = generatedQuestions.questionsForLecture("u1", "lecA");
    expect(saved.highlights).toEqual(["polyuria"]);
  });

  it("appends further highlights without dropping earlier ones", () => {
    generatedQuestions.addQuestions("u1", "lecB", [q]);
    generatedQuestions.addHighlight("u1", "lecB", q.stem, "polyuria");
    generatedQuestions.addHighlight("u1", "lecB", q.stem, "45-year-old");
    const [saved] = generatedQuestions.questionsForLecture("u1", "lecB");
    expect(saved.highlights).toEqual(["polyuria", "45-year-old"]);
  });

  it("does not duplicate the same phrase twice", () => {
    generatedQuestions.addQuestions("u1", "lecC", [q]);
    generatedQuestions.addHighlight("u1", "lecC", q.stem, "polyuria");
    generatedQuestions.addHighlight("u1", "lecC", q.stem, "polyuria");
    const [saved] = generatedQuestions.questionsForLecture("u1", "lecC");
    expect(saved.highlights).toEqual(["polyuria"]);
  });

  it("is a no-op for a lecture with no stored pool", () => {
    expect(() => generatedQuestions.addHighlight("u1", "lec-missing", q.stem, "polyuria")).not.toThrow();
    expect(generatedQuestions.questionsForLecture("u1", "lec-missing")).toEqual([]);
  });

  it("leaves other questions in the pool untouched", () => {
    const other = { stem: "Another question?", choices: { A: "x", B: "y" }, correct: "B" };
    generatedQuestions.addQuestions("u1", "lecD", [q, other]);
    generatedQuestions.addHighlight("u1", "lecD", q.stem, "polyuria");
    const saved = generatedQuestions.questionsForLecture("u1", "lecD");
    expect(saved.find((s) => s.stem === other.stem).highlights).toBeUndefined();
  });
});
