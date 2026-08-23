import { describe, expect, it, vi } from "vitest";
import {
  lectureTextFrom,
  flowStage,
  loadLecture,
  extractAtoms,
  quizFromAtoms,
  roundDifficulty,
  topicsToAutoCheck,
} from "./lectureStudy.js";

const BODY = "Brachial plexus anatomy in detail. ".repeat(20);
const atom = (over = {}) => ({ type: "definition", term: "Plexus", content: "A nerve network.", ...over });

describe("lecture text", () => {
  it("prefers chunks, then flat fields", () => {
    expect(lectureTextFrom({ chunks: [{ markdown: "a" }, { text: "b" }] })).toBe("a\n\nb");
    expect(lectureTextFrom({ chunks: [], fullText: "flat" })).toBe("flat");
    expect(lectureTextFrom({ meta: { extractedText: "from meta" } })).toBe("from meta");
    expect(lectureTextFrom(null)).toBe("");
  });
});

describe("flowStage", () => {
  it("sends you to the quiz when atoms already exist", () => {
    expect(flowStage({ atoms: [atom()], text: "" })).toBe("quiz");
  });

  it("offers extraction when there is enough text", () => {
    expect(flowStage({ atoms: [], text: BODY })).toBe("extract");
  });

  it("falls back to upload when the lecture is chunk-light", () => {
    expect(flowStage({ atoms: [], text: "too short" })).toBe("upload");
    expect(flowStage({})).toBe("upload");
  });
});

describe("loadLecture", () => {
  it("uses local content without touching the cloud", async () => {
    const fetchContent = vi.fn();
    const result = await loadLecture(
      { id: "lec1", chunks: [{ markdown: BODY }], atoms: [atom()] },
      { fetchContent, userId: "u1" }
    );
    expect(fetchContent).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stage: "quiz", error: null });
  });

  it("falls back to the cloud for a chunk-light lecture", async () => {
    const fetchContent = vi.fn().mockResolvedValue({ chunks: [{ markdown: BODY }], atoms: [] });
    const result = await loadLecture({ id: "lec1" }, { fetchContent, userId: "u1" });

    expect(fetchContent).toHaveBeenCalledWith("u1", "lec1");
    expect(result.text).toContain("Brachial plexus");
    expect(result.stage).toBe("extract");
  });

  it("takes cloud atoms when the lecture has none locally", async () => {
    const fetchContent = vi.fn().mockResolvedValue({ chunks: [], atoms: [atom()] });
    expect((await loadLecture({ id: "lec1" }, { fetchContent })).stage).toBe("quiz");
  });

  it("reports a cloud failure instead of throwing", async () => {
    const fetchContent = vi.fn().mockRejectedValue(new Error("offline"));
    const result = await loadLecture({ id: "lec1" }, { fetchContent });
    expect(result).toMatchObject({ stage: "upload", error: "offline" });
  });

  it("survives a lecture the cloud has never heard of", async () => {
    const fetchContent = vi.fn().mockResolvedValue(null);
    expect((await loadLecture({ id: "ghost" }, { fetchContent })).stage).toBe("upload");
  });
});

describe("extractAtoms", () => {
  const aiAtoms = { atoms: [{ type: "definition", term: "Plexus", content: "A nerve network." }] };

  it("extracts and persists to the lecture", async () => {
    const callAIJSON = vi.fn().mockResolvedValue(aiAtoms);
    const saveAtoms = vi.fn().mockResolvedValue({ saved: 1 });

    const result = await extractAtoms({ id: "lec1", lectureTitle: "Plexus" }, BODY, {
      callAIJSON, saveAtoms, userId: "u1",
    });

    expect(result).toMatchObject({ saved: true, error: null });
    expect(result.atoms).toHaveLength(1);
    expect(saveAtoms).toHaveBeenCalledWith("u1", "lec1", result.atoms);
  });

  it("keeps the atoms when the save fails", async () => {
    const callAIJSON = vi.fn().mockResolvedValue(aiAtoms);
    const saveAtoms = vi.fn().mockRejectedValue(new Error("permission denied"));

    const result = await extractAtoms({ id: "lec1" }, BODY, { callAIJSON, saveAtoms });

    expect(result.atoms).toHaveLength(1);
    expect(result.saved).toBe(false);
    expect(result.saveError).toBe("permission denied");
  });

  it("reports too-short text and an empty extraction", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({ atoms: [] });
    expect((await extractAtoms({ id: "l" }, "short", { callAIJSON })).error).toMatch(/Not enough lecture text/);
    expect((await extractAtoms({ id: "l" }, BODY, { callAIJSON })).error).toMatch(/No atoms/);
  });
});

describe("quizFromAtoms", () => {
  it("asks one question per atom, titled with the lecture", async () => {
    const callAIJSON = vi.fn().mockResolvedValue({
      questions: [{ stem: "A patient presents. Which nerve?", choices: { A: "1", B: "2", C: "3", D: "4" }, correct: "A" }],
    });

    const result = await quizFromAtoms({ lectureTitle: "Brachial Plexus" }, [atom()], { callAIJSON });

    expect(result.questions).toHaveLength(1);
    expect(callAIJSON.mock.calls[0][1]).toContain("Brachial Plexus");
    expect(callAIJSON.mock.calls[0][1]).toContain("[definition] Plexus: A nerve network.");
  });

  it("passes the error through rather than throwing", async () => {
    const callAIJSON = vi.fn().mockRejectedValue(new Error("model down"));
    expect((await quizFromAtoms({}, [atom()], { callAIJSON })).error).toBe("model down");
  });
});

describe("roundDifficulty", () => {
  it("ramps easy -> medium -> hard -> expert by round index when starting fresh", () => {
    expect(roundDifficulty("easy", 0)).toBe("easy");
    expect(roundDifficulty("easy", 1)).toBe("medium");
    expect(roundDifficulty("easy", 2)).toBe("hard");
    expect(roundDifficulty("easy", 3)).toBe("expert");
  });

  it("caps at expert past the top of the scale", () => {
    expect(roundDifficulty("easy", 10)).toBe("expert");
  });

  it("starts further up the scale when the lecture's accuracy already earned it, still ramping from there", () => {
    expect(roundDifficulty("hard", 0)).toBe("hard");
    expect(roundDifficulty("hard", 1)).toBe("expert");
    expect(roundDifficulty("hard", 2)).toBe("expert"); // capped
  });

  it("defaults an unrecognized base difficulty to easy", () => {
    expect(roundDifficulty("nonsense", 0)).toBe("easy");
  });
});

describe("topicsToAutoCheck", () => {
  const atoms = [
    { term: "Herring bodies", content: "Axonal dilations storing hormone and neurophysin in the posterior pituitary." },
    { term: "Prolactin", content: "Dopamine inhibits its secretion from lactotrophs." },
  ];
  const topics = [
    { id: "t1", text: "posterior pituitary hormone storage", checked: false },
    { id: "t2", text: "dopamine inhibition of prolactin secretion", checked: false },
    { id: "t3", text: "unrelated topic about the kidney", checked: false },
  ];

  it("checks the topic matching a correctly-answered question's concept", () => {
    const records = [{ concept: "Prolactin", correct: true }];
    expect(topicsToAutoCheck(records, atoms, topics)).toEqual(["t2"]);
  });

  it("does not check anything for a wrong answer", () => {
    const records = [{ concept: "Prolactin", correct: false }];
    expect(topicsToAutoCheck(records, atoms, topics)).toEqual([]);
  });

  it("skips a topic that's already checked", () => {
    const alreadyChecked = topics.map((t) => (t.id === "t2" ? { ...t, checked: true } : t));
    const records = [{ concept: "Prolactin", correct: true }];
    expect(topicsToAutoCheck(records, atoms, alreadyChecked)).toEqual([]);
  });

  it("falls back to the bare concept string when the atom isn't found", () => {
    const records = [{ concept: "dopamine inhibition of prolactin secretion", correct: true }];
    expect(topicsToAutoCheck(records, [], topics)).toEqual(["t2"]);
  });

  it("returns nothing when no correct answer clears the match threshold", () => {
    const records = [{ concept: "Herring bodies", correct: true }];
    expect(topicsToAutoCheck(records, atoms, [{ id: "t9", text: "unrelated topic about the kidney", checked: false }])).toEqual([]);
  });

  it("dedupes when two correct answers match the same topic", () => {
    const records = [
      { concept: "Prolactin", correct: true },
      { concept: "dopamine inhibition of prolactin secretion", correct: true },
    ];
    expect(topicsToAutoCheck(records, atoms, topics)).toEqual(["t2"]);
  });
});
