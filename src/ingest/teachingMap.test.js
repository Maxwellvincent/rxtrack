import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const callAI = vi.fn();
vi.mock("../aiClient.js", () => ({ callAI: (...a) => callAI(...a) }));

const { analyzeLecture, buildTeachingMapUserPrompt, TEACHING_MAP_SYSTEM_PROMPT } = await import(
  "./teachingMap.js"
);

const lec = {
  id: "lec1",
  lectureTitle: "Adrenal Cortex",
  lectureType: "LEC",
  lectureNumber: 6,
  subtopics: ["Cortisol", "Aldosterone"],
};

const goodMap = {
  summary: "The adrenal cortex and its hormones.",
  clinicalHook: "A 42-year-old woman with weight gain and purple striae.",
  bigPicture: "Cortisol excess explains the whole picture.",
  sections: [{ title: "Zona fasciculata", coreContent: "Cortisol is made here.", objectives: ["Describe cortisol"] }],
};

beforeEach(() => {
  callAI.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("buildTeachingMapUserPrompt", () => {
  it("names the lecture and caps the content it sends", () => {
    const prompt = buildTeachingMapUserPrompt(lec, "Zz".repeat(4500));
    expect(prompt).toContain("Adrenal Cortex");
    expect(prompt).toContain("LEC 6");
    expect(prompt.match(/(?:Zz)+/)[0]).toHaveLength(6000);
  });

  it("copes with a lecture that has no title or number", () => {
    expect(() => buildTeachingMapUserPrompt({}, "")).not.toThrow();
  });
});

describe("analyzeLecture", () => {
  it("returns the map the model produced", async () => {
    callAI.mockResolvedValue(JSON.stringify(goodMap));
    const map = await analyzeLecture(lec, "lecture text");

    expect(map).toMatchObject(goodMap);
    expect(callAI).toHaveBeenCalledWith(TEACHING_MAP_SYSTEM_PROMPT, expect.any(String), 2500);
  });

  it("reads sections back from a fenced response", async () => {
    callAI.mockResolvedValue("```json\n" + JSON.stringify(goodMap) + "\n```");
    expect((await analyzeLecture(lec, "text")).sections).toHaveLength(1);
  });

  it("accepts sections under the other keys the model has used", async () => {
    callAI.mockResolvedValue(JSON.stringify({ map: [{ title: "A" }] }));
    expect((await analyzeLecture(lec, "text")).sections[0].title).toBe("A");

    callAI.mockResolvedValue(JSON.stringify({ content: [{ title: "B" }] }));
    expect((await analyzeLecture(lec, "text")).sections[0].title).toBe("B");
  });

  it("accepts a bare array of sections", async () => {
    callAI.mockResolvedValue(JSON.stringify([{ title: "C" }]));
    const map = await analyzeLecture(lec, "text");

    expect(map.sections[0].title).toBe("C");
    expect(map.summary).toBe("");
    expect(Array.isArray(map)).toBe(false);
  });

  it("falls back to one section per subtopic when the model returns no sections", async () => {
    callAI.mockResolvedValue(JSON.stringify({ summary: "s", clinicalHook: "h", bigPicture: "b" }));
    const map = await analyzeLecture(lec, "text");

    expect(map.sections.map((s) => s.title)).toEqual(["Cortisol", "Aldosterone"]);
    // The prose the model did return is kept — only the sections were missing.
    expect(map).toMatchObject({ summary: "s", clinicalHook: "h", bigPicture: "b" });
  });

  it("falls back to a single Overview section when there are no subtopics either", async () => {
    callAI.mockResolvedValue("{}");
    const map = await analyzeLecture({ ...lec, subtopics: [] }, "text");
    expect(map.sections).toHaveLength(1);
    expect(map.sections[0].title).toBe("Overview");
  });

  it("falls back rather than throwing when the response is not JSON", async () => {
    callAI.mockResolvedValue("I could not analyze that lecture.");
    expect((await analyzeLecture(lec, "text")).sections).toHaveLength(2);
  });

  it("returns an empty map when the call itself fails", async () => {
    callAI.mockRejectedValue(new Error("quota exhausted"));
    expect(await analyzeLecture(lec, "text")).toEqual({
      summary: "",
      clinicalHook: "",
      sections: [],
      bigPicture: "",
    });
  });
});
