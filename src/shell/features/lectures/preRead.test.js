import { describe, expect, it } from "vitest";
import { preReadSource, preReadGaps, generatePreRead, PRE_READ_QUESTION_COUNT } from "./preRead.js";

describe("preReadSource", () => {
  it("uses the lecture body when there is one to read", () => {
    const lecture = { lectureTitle: "Adrenal Steroidogenesis", chunks: [{ markdown: "x".repeat(400) }] };
    const source = preReadSource(lecture, [{ id: "o1", objective: "Describe cortisol synthesis" }]);

    expect(source.kind).toBe("text");
    expect(source.text.length).toBeGreaterThan(200);
  });

  it("falls back to the objectives when the lecture has no uploaded text", () => {
    const source = preReadSource({ lectureTitle: "Adrenal Steroidogenesis" }, [
      { id: "o1", objective: "Describe cortisol synthesis" },
      { id: "o2", objective: "Explain the HPA axis" },
    ]);

    expect(source.kind).toBe("objectives");
    expect(source.text).toContain("cortisol synthesis");
    expect(source.text).toContain("HPA axis");
  });

  it("falls back to the title alone for a bare schedule stub", () => {
    // Schedule import creates dated stubs with no objectives and no body; the
    // night before lecture is exactly when a stub still needs to be pre-readable.
    const source = preReadSource({ lectureTitle: "Adrenal Steroidogenesis", subject: "Endocrine" }, []);

    expect(source.kind).toBe("title");
    expect(source.text).toContain("Adrenal Steroidogenesis");
    expect(source.text).toContain("Endocrine");
  });

  it("reports when there is nothing at all to work from", () => {
    expect(preReadSource({}, []).kind).toBe("none");
  });
});

describe("preReadGaps", () => {
  const questions = [
    { id: "q1", objectiveId: "o1", correctIndex: 0 },
    { id: "q2", objectiveId: "o2", correctIndex: 2 },
    { id: "q3", objectiveId: "o2", correctIndex: 1 },
    { id: "q4", objectiveId: "o3", correctIndex: 3 },
  ];

  it("returns the objectives behind the missed questions, deduped and in order", () => {
    const answers = { q1: 0, q2: 0, q3: 3, q4: 3 };

    const gaps = preReadGaps(questions, answers);

    expect(gaps.objectiveIds).toEqual(["o2"]);
    expect(gaps.missed).toBe(2);
    expect(gaps.correct).toBe(2);
  });

  it("treats an unanswered question as a gap", () => {
    const gaps = preReadGaps(questions, { q1: 0, q2: 2, q3: 1 });

    expect(gaps.objectiveIds).toEqual(["o3"]);
    expect(gaps.missed).toBe(1);
  });
});

describe("generatePreRead", () => {
  const lecture = { id: "lec1", lectureTitle: "Adrenal Steroidogenesis", subject: "Endocrine" };
  const objectives = [
    { id: "o1", objective: "Describe cortisol synthesis" },
    { id: "o2", objective: "Explain the HPA axis" },
  ];

  it("asks for five questions and topics, and tags each question to a real objective", async () => {
    let seenPrompt = "";
    const callAIJSON = async (_system, prompt) => {
      seenPrompt = prompt;
      return {
        topics: ["cortisol synthesis pathway", "HPA axis feedback"],
        questions: [
          { objectiveId: "o1", question: "Which enzyme starts it?", choices: ["A", "B", "C", "D"], correctIndex: 1, explanation: "…" },
          { objectiveId: "nonsense", question: "Second?", choices: ["A", "B"], correctIndex: 0, explanation: "…" },
        ],
      };
    };

    const result = await generatePreRead({ lecture, objectives }, { callAIJSON });

    expect(seenPrompt).toContain(String(PRE_READ_QUESTION_COUNT));
    expect(seenPrompt).toContain("Adrenal Steroidogenesis");
    expect(result.topics).toEqual(["cortisol synthesis pathway", "HPA axis feedback"]);
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].objectiveId).toBe("o1");
    // A hallucinated objective id would break lecture-day gap ordering.
    expect(result.questions[1].objectiveId).toBe(null);
    expect(result.questions[0].id).toBeTruthy();
  });

  it("still produces topics from a bare stub with no objectives and no text", async () => {
    const callAIJSON = async () => ({ topics: ["adrenal cortex zones"], questions: [] });

    const result = await generatePreRead({ lecture, objectives: [] }, { callAIJSON });

    expect(result.sourceKind).toBe("title");
    expect(result.topics).toEqual(["adrenal cortex zones"]);
    expect(result.error).toBeFalsy();
  });

  it("reports the failure instead of throwing when the model call dies", async () => {
    const callAIJSON = async () => { throw new Error("no provider key"); };

    const result = await generatePreRead({ lecture, objectives }, { callAIJSON });

    expect(result.error).toContain("no provider key");
    expect(result.questions).toEqual([]);
  });
});
