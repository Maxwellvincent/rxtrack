import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  chunkText,
  tryParseObjectivesJSON,
  deduplicateExtractedObjectives,
  isValidObjective,
  filterExtractedObjectivesQuality,
  normalizeSomCodesInText,
  findObjectivesTableChunk,
  buildObjEntry,
  extractFromTableText,
  parseObjectiveActivityTag,
} from "./objectives.js";

/** The AI-free half of the extractor. The passes that call a model are covered
 *  by the live upload, not here — what is worth pinning is the parsing. */

const lec = { id: "lec1", lectureType: "LEC", lectureNumber: 3, lectureTitle: "The Back" };

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("chunkText", () => {
  it("returns one chunk when the text fits", () => {
    expect(chunkText("short text", 3000)).toEqual(["short text"]);
  });

  it("breaks on a newline rather than mid-line", () => {
    const line = "a".repeat(90) + "\n";
    const chunks = chunkText(line.repeat(10), 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].endsWith("a")).toBe(true);
  });

  it("falls back to a hard cut when no newline is near the boundary", () => {
    const chunks = chunkText("b".repeat(500), 100);
    expect(chunks[0]).toHaveLength(100);
  });

  it("has nothing to say about empty text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText(null)).toEqual([]);
  });
});

describe("tryParseObjectivesJSON", () => {
  it("parses a fenced model response", () => {
    expect(tryParseObjectivesJSON('```json\n{"objectives":[{"text":"Describe X"}]}\n```')).toEqual({
      objectives: [{ text: "Describe X" }],
    });
  });

  it("digs the object out of a chatty response", () => {
    const raw = 'Sure! Here you go:\n{"objectives":[]}\nHope that helps.';
    expect(tryParseObjectivesJSON(raw)).toEqual({ objectives: [] });
  });

  it("returns null rather than throwing on junk", () => {
    expect(tryParseObjectivesJSON("no json here at all")).toBeNull();
    expect(tryParseObjectivesJSON("")).toBeNull();
  });
});

describe("deduplicateExtractedObjectives", () => {
  it("collapses objectives that differ only in punctuation and case", () => {
    const out = deduplicateExtractedObjectives([
      { objective: "Describe the vertebral column." },
      { objective: "describe the vertebral column" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("prefers the copy that carries a SOM code", () => {
    const out = deduplicateExtractedObjectives([
      { objective: "Describe the vertebral column" },
      { objective: "Describe the vertebral column", code: "SOM.MK.I.BPM1.3.CPR.1.INTG.0024" },
    ]);
    expect(out[0].code).toBe("SOM.MK.I.BPM1.3.CPR.1.INTG.0024");
  });

  it("drops fragments too short to key on", () => {
    expect(deduplicateExtractedObjectives([{ objective: "List it" }])).toEqual([]);
  });
});

describe("isValidObjective", () => {
  it("accepts a verb-led objective", () => {
    expect(isValidObjective("Describe the course of the vagus nerve")).toBe(true);
  });

  it("rejects a bare code, a fragment and a non-objective sentence", () => {
    expect(isValidObjective("SOM.MK.I.BPM1.3.CPR.1.INTG.0024")).toBe(false);
    expect(isValidObjective("the back")).toBe(false);
    expect(isValidObjective("This lecture covers the vertebral column")).toBe(false);
  });
});

describe("filterExtractedObjectivesQuality", () => {
  it("keeps a SOM-coded row even when it does not open with a whitelisted verb", () => {
    const objs = [{ text: "The vertebral column and its regions", code: "SOM.MK.I.BPM1.0001" }];
    expect(filterExtractedObjectivesQuality(objs, lec)).toHaveLength(1);
  });

  it("drops uncoded prose that is not an objective", () => {
    const objs = [
      { text: "Describe the vertebral column" },
      { text: "Slide 12 of 40" },
    ];
    const kept = filterExtractedObjectivesQuality(objs, lec);
    expect(kept).toHaveLength(1);
    expect(kept[0].text).toMatch(/vertebral/);
  });

  it("returns nothing for nothing", () => {
    expect(filterExtractedObjectivesQuality([], lec)).toEqual([]);
    expect(filterExtractedObjectivesQuality(null, lec)).toEqual([]);
  });
});

describe("normalizeSomCodesInText", () => {
  it("rejoins a code split before its four-digit suffix", () => {
    expect(normalizeSomCodesInText("SOM.MK.I.BPM1.3.CPR.1.INTG. 0024")).toBe(
      "SOM.MK.I.BPM1.3.CPR.1.INTG.0024"
    );
  });

  it("unwraps the markdown link OCR puts around the prefix", () => {
    expect(
      normalizeSomCodesInText("[SOM.MK](http://SOM.MK).I.BPM1.3.CPR.1.INTG.0024")
    ).toBe("SOM.MK.I.BPM1.3.CPR.1.INTG.0024");
  });

  it("turns a semicolon continuation into the // syntax the expander reads", () => {
    expect(normalizeSomCodesInText("SOM.MK.I.BPM1.3.CPR.1.INTG.0018; 0024")).toBe(
      "SOM.MK.I.BPM1.3.CPR.1.INTG.0018//0024"
    );
  });

  it("leaves ordinary text alone", () => {
    expect(normalizeSomCodesInText("Describe the vertebral column")).toBe(
      "Describe the vertebral column"
    );
  });
});

describe("findObjectivesTableChunk", () => {
  const chunks = [
    { markdown: "# Title slide" },
    { markdown: "Objectives\nSOM.MK.I.BPM1.0001  Describe the back" },
    { markdown: "SOM.MK.I.BPM1.0009  Summarize the joints" },
  ];

  it("finds the first chunk that looks like the objectives table", () => {
    expect(findObjectivesTableChunk(chunks).markdown).toContain("Objectives");
  });

  it("takes the last match when asked — merged Part A+B decks have two", () => {
    expect(findObjectivesTableChunk(chunks, { preferLast: true }).markdown).toContain("Summarize");
  });

  it("returns null when no chunk matches", () => {
    expect(findObjectivesTableChunk([{ markdown: "just slides" }])).toBeNull();
  });
});

describe("parseObjectiveActivityTag", () => {
  it("pulls a trailing session tag off the text", () => {
    expect(parseObjectiveActivityTag("Describe the sarcomere (SG)")).toEqual({
      text: "Describe the sarcomere",
      activity: "SG",
    });
  });

  it("leaves untagged text alone", () => {
    expect(parseObjectiveActivityTag("Describe the sarcomere")).toEqual({
      text: "Describe the sarcomere",
      activity: null,
    });
  });
});

describe("buildObjEntry", () => {
  it("links the objective to the lecture and grades its bloom level from the verb", () => {
    const entry = buildObjEntry("SOM.MK.I.BPM1.0001", "Compare the two joint types", lec, "b1");
    expect(entry).toMatchObject({
      blockId: "b1",
      linkedLecId: "lec1",
      sourceFile: "lec1",
      objective: "Compare the two joint types",
      code: "SOM.MK.I.BPM1.0001",
      objectiveCode: "SOM.MK.I.BPM1.0001",
      lectureType: "LEC",
      lectureNumber: 3,
      bloom_level: 4,
      bloom_level_name: "Analyze",
      status: "untested",
    });
  });

  it("defaults to Understand for a verb it does not know", () => {
    expect(buildObjEntry("", "Ponder the vertebral column", lec, "b1").bloom_level).toBe(2);
  });

  it("takes the activity from a session tag, else the lecture type", () => {
    expect(buildObjEntry("", "Describe the sarcomere (TBL)", lec, "b1").activity).toBe("TBL");
    expect(buildObjEntry("", "Describe the sarcomere", lec, "b1").activity).toBe("LEC");
  });
});

describe("extractFromTableText", () => {
  it("reads code-then-text rows off one line", () => {
    const text = [
      "SOM.MK.I.BPM1.0001   Describe the regions of the vertebral column",
      "SOM.MK.I.BPM1.0002   Summarize the joints of the back",
      "SOM.MK.I.BPM1.0003   Outline the muscles of the back",
    ].join("\n");

    const out = extractFromTableText(text, lec, "b1");
    expect(out).toHaveLength(3);
    expect(out[0].code).toBe("SOM.MK.I.BPM1.0001");
    expect(out[0].objective).toMatch(/regions of the vertebral column/);
  });

  it("reads a markdown pipe table", () => {
    const text = "SOM.MK.I.BPM1.0001 | Describe the regions of the vertebral column";
    const out = extractFromTableText(text, lec, "b1");
    expect(out).toHaveLength(1);
    expect(out[0].objective).toBe("Describe the regions of the vertebral column");
  });

  it("picks up an objective sitting on the line after a lone code", () => {
    const text = "SOM.MK.I.BPM1.0001\nDescribe the regions of the vertebral column";
    const out = extractFromTableText(text, lec, "b1");
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe("SOM.MK.I.BPM1.0001");
  });

  it("normalizes a split code before matching", () => {
    const text = "SOM.MK.I.BPM1.3.CPR.1.INTG. 0024   Describe the regions of the vertebral column";
    expect(extractFromTableText(text, lec, "b1")[0].code).toBe("SOM.MK.I.BPM1.3.CPR.1.INTG.0024");
  });

  it("never emits a code with no objective text", () => {
    expect(extractFromTableText("SOM.MK.I.BPM1.0001\nSOM.MK.I.BPM1.0002", lec, "b1")).toEqual([]);
    expect(extractFromTableText("", lec, "b1")).toEqual([]);
  });
});
