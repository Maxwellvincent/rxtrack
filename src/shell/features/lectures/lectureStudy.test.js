import { describe, expect, it, vi } from "vitest";
import {
  lectureTextFrom,
  flowStage,
  loadLecture,
  extractAtoms,
  quizFromAtoms,
  roundDifficulty,
  topicsToAutoCheck,
  selectAtomsForQuiz,
  isActiveQuizComplete,
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
  it("uses the baseline for round one and expert transfer questions from round two onward", () => {
    expect(roundDifficulty("easy", 0)).toBe("easy");
    expect(roundDifficulty("easy", 1)).toBe("expert");
    expect(roundDifficulty("easy", 2)).toBe("expert");
    expect(roundDifficulty("easy", 3)).toBe("expert");
  });

  it("caps at expert past the top of the scale", () => {
    expect(roundDifficulty("easy", 10)).toBe("expert");
  });

  it("starts at the earned baseline before the expert transfer round", () => {
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

describe("selectAtomsForQuiz", () => {
  const a = (term) => ({ type: "definition", term, content: "x" });
  const list = [a("Thyroglobulin"), a("Pendrin"), a("TSH receptor"), a("Deiodinase")];

  it("with no progress at all, returns the first N atoms in order", () => {
    const out = selectAtomsForQuiz(list, {}, 2);
    expect(out.map((x) => x.term)).toEqual(["Thyroglobulin", "Pendrin"]);
  });

  it("puts not-yet-complete atoms before already-mastered ones", () => {
    const progress = { thyroglobulin: { status: "complete" }, pendrin: { status: "needs-review" } };
    const out = selectAtomsForQuiz(list, progress, 3);
    // pendrin (needs-review), tsh receptor + deiodinase (untouched) all outrank the completed one
    expect(out.map((x) => x.term)).toEqual(["Pendrin", "TSH receptor", "Deiodinase"]);
  });

  it("never repeats an atom while incomplete ones remain to cover the count", () => {
    const progress = { thyroglobulin: { status: "complete" } };
    const out = selectAtomsForQuiz(list, progress, 3);
    expect(new Set(out.map((x) => x.term)).size).toBe(3);
    expect(out.map((x) => x.term)).not.toContain("Thyroglobulin");
  });

  it("only starts repeating once every atom has had a turn, incomplete atoms first on the repeat lap", () => {
    const out = selectAtomsForQuiz(list, {}, 6); // 4 atoms, 6 requested
    expect(out.map((x) => x.term)).toEqual([
      "Thyroglobulin", "Pendrin", "TSH receptor", "Deiodinase", // first lap
      "Thyroglobulin", "Pendrin", // second lap starts over
    ]);
  });

  it("draws from mastered atoms once every incomplete atom is already covered by the count", () => {
    const progress = {
      thyroglobulin: { status: "needs-review" },
      pendrin: { status: "complete" },
      "tsh receptor": { status: "complete" },
      deiodinase: { status: "complete" },
    };
    const out = selectAtomsForQuiz(list, progress, 2);
    expect(out.map((x) => x.term)).toEqual(["Thyroglobulin", "Pendrin"]);
  });

  it("returns nothing for zero atoms or zero count", () => {
    expect(selectAtomsForQuiz([], {}, 5)).toEqual([]);
    expect(selectAtomsForQuiz(list, {}, 0)).toEqual([]);
  });
});

describe("quiz completion ownership", () => {
  it("does not show an old quiz's completion state under a newly generated quiz", () => {
    expect(isActiveQuizComplete(1, 1)).toBe(true);
    expect(isActiveQuizComplete(null, 2)).toBe(false);
    // A late completion callback from session 1 must not complete active session 2.
    expect(isActiveQuizComplete(1, 2)).toBe(false);
  });
});
