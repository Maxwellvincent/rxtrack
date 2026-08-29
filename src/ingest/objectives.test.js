import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  extractObjectivesFromStandaloneDoc,
  chunkText,
  tryParseObjectivesJSON,
  deduplicateExtractedObjectives,
  isValidObjective,
  filterExtractedObjectivesQuality,
  normalizeSomCodesInText,
  findObjectivesTableChunk,
  buildObjEntry,
  extractCodeDelimited,
  extractFromTableText,
  parseObjectiveActivityTag,
  extractObjectivesFromLecture,
  extractScopedLectureObjectives,
  sanitizeObjectiveText,
} from "./objectives.js";
import { execFileSync } from "node:child_process";

/** The AI-free half of the extractor. The passes that call a model are covered
 *  by the live upload, not here — what is worth pinning is the parsing. */

// No test here wants a model. A stub that returns nothing keeps any AI pass
// visible as an empty result rather than a network call.
vi.mock("../aiClient.js", () => ({
  callAI: vi.fn(async () => ""),
  callAIJSON: vi.fn(async (_s, _u, fallback) => fallback),
}));

const lec = { id: "lec1", lectureType: "LEC", lectureNumber: 3, lectureTitle: "The Back" };

it("stops a malformed one-code objective before lecture resources and markdown tables", () => {
  const raw = "SOM.MKII.BPM2.1.ER.1.ANAT.1083 Describe the development of the male reproductive ducts and associated glands. | ## Recommended reading and resources The Developing Human | |---|---|";
  expect(sanitizeObjectiveText(raw)).toBe("Describe the development of the male reproductive ducts and associated glands.");
  const [objective] = extractCodeDelimited(raw, lec, "er");
  expect(objective.objective).toBe("Describe the development of the male reproductive ducts and associated glands.");
});

describe("separate lecture and DLA objective slides", () => {
  const mixed = "DLA: Developmental Genetics Objectives\nSOM.MK.ER.GNET.1001 Describe developmental signaling.\fLecture Objectives Genetic Screening\nSOM.MK.ER.GNET.1012 Differentiate screening strategies.\nSOM.MK.ER.GNET.1013 Discuss predictive testing.\fOther slide\nSOM.MK.ER.GNET.1014 Incidental footer content.";
  it("selects only the lecture objective slide", async () => {
    expect((await extractObjectivesFromLecture(mixed, lec, "er")).map((o) => o.code))
      .toEqual(["SOM.MK.ER.GNET.1012", "SOM.MK.ER.GNET.1013"]);
  });
  it("keeps the DLA objectives available for a DLA upload", () => {
    expect(extractScopedLectureObjectives(mixed, { ...lec, lectureType: "DLA" }, "er").map((o) => o.code))
      .toEqual(["SOM.MK.ER.GNET.1001"]);
  });
  it("respects markdown page separators from the upload parser", async () => {
    const markdown = mixed.replace(/\f/g, "\n\n---\n\n");
    const result = await extractObjectivesFromLecture(markdown, lec, "er");
    expect(result.map((o) => o.code)).toEqual(["SOM.MK.ER.GNET.1012", "SOM.MK.ER.GNET.1013"]);
    expect(result[1].objective).not.toContain("Other slide");
  });
  it.skipIf(!process.env.RXTRACK_VERIFY_PDF)("verifies all eight objectives against the actual Genetic Screening PDF", async () => {
    const text = execFileSync("pdftotext", ["-raw", process.env.RXTRACK_VERIFY_PDF, "-"], { encoding: "utf8" });
    const result = await extractObjectivesFromLecture(text, { ...lec, lectureTitle: "Genetic Screening", lectureNumber: 21 }, "er");
    expect(result.map((o) => o.code.split(".").at(-1))).toEqual(["1012", "1013", "1014", "1015", "1016", "1017", "1018", "1019"]);
    expect(result.every((o) => o.linkedLecId === lec.id)).toBe(true);
  });
});

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

describe("extractCodeDelimited — the format the decks actually use", () => {
  // Verbatim from Lecture 10 - Pelvis and Perineum I: lowercase segments in the
  // code, ONE space before the text, and objectives that wrap across lines.
  const real = `Objectives: Lectures 10, 11 & 14

SOM.1ai.BMP2.2.ER.1.ANAT.RP.0705 Describe the external genitalia in males and contrast it to that of females.
SOM.1ai.BMP2.2.ER.1.ANAT.RP.0706 Describe an oblique episiotomy and it's clinical significance
SOM.1ai.BMP2.2.ER.1.ANAT.RP.0707 Identify the major organs of the pelvis in CT, MRI and radiological images.
SOM.1ai.BMP2.2.ER.1.ANAT.RP.0708 Describe Colles' fascia and its relationship with the superficial fascia of the
abdomen and scrotum/labia.

SOM.1ai.BMP2.2.ER.1.ANAT.RP.0805 Describe the arterial supply, venous drainage and lymphatic drainage of the
perineum.`;

  it("keeps the lowercase segments instead of truncating every code to SOM.1", () => {
    const out = extractCodeDelimited(real, lec, "b1");
    expect(out).toHaveLength(5);
    expect(out.map((o) => o.code)).toEqual([
      "SOM.1ai.BMP2.2.ER.1.ANAT.RP.0705",
      "SOM.1ai.BMP2.2.ER.1.ANAT.RP.0706",
      "SOM.1ai.BMP2.2.ER.1.ANAT.RP.0707",
      "SOM.1ai.BMP2.2.ER.1.ANAT.RP.0708",
      "SOM.1ai.BMP2.2.ER.1.ANAT.RP.0805",
    ]);
  });

  it("takes the text after a single space, not two", () => {
    expect(extractCodeDelimited(real, lec, "b1")[0].objective).toBe(
      "Describe the external genitalia in males and contrast it to that of females."
    );
  });

  it("keeps an objective that wraps onto the next line whole", () => {
    const wrapped = extractCodeDelimited(real, lec, "b1").find((o) => o.code.endsWith("0708"));
    expect(wrapped.objective).toBe(
      "Describe Colles' fascia and its relationship with the superficial fascia of the abdomen and scrotum/labia."
    );
  });

  it("is what extractFromTableText now uses for this shape", () => {
    expect(extractFromTableText(real, lec, "b1")).toHaveLength(5);
  });

  it("still returns nothing when there are no codes", () => {
    expect(extractCodeDelimited("Just some slide prose.", lec, "b1")).toEqual([]);
  });

  it("skips a code with no text after it", () => {
    expect(extractCodeDelimited("SOM.1ai.BPM2.1.ER.1.PHYS.EN.0101\nSOM.1ai.BPM2.1.ER.1.PHYS.EN.0102", lec, "b1"))
      .toHaveLength(0);
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

describe("extractObjectivesFromStandaloneDoc — the block objectives document", () => {
  /** A coded objectives doc, long enough that a first-N-chars prompt would clip it. */
  function longCodedDoc() {
    const rows = [];
    rows.push("| Lecture PHYS | Endocrine Overview |");
    for (let i = 1; i <= 160; i++) {
      const code = `SOM.MK.I.BPM2.2.ER.1.HCB.${1000 + i}`;
      rows.push(`| ${code} | Describe endocrine structure number ${i} and its clinical relevance in detail. |`);
    }
    rows.push("| Lecture ANAT | Female Perineum |");
    rows.push("| SOM.MK.I.BPM2.2.ER.9.ANAT.9999 | Identify the boundaries of the perineum. |");
    return rows.join("\n");
  }

  it("reads objectives past the first 14000 characters", async () => {
    const doc = longCodedDoc();
    expect(doc.length).toBeGreaterThan(14000);

    const objs = await extractObjectivesFromStandaloneDoc(doc, [], "b1");

    expect(objs.map((o) => o.code)).toContain("SOM.MK.I.BPM2.2.ER.9.ANAT.9999");
    expect(objs.length).toBe(161);
  });
});

describe("extractObjectivesFromStandaloneDoc — matching a section to a lecture", () => {
  const lectures = [
    { id: "lec23", lectureType: "LEC", lectureNumber: 23, lectureTitle: "Nutritional Aspects of Pregnancy, Lactation and Infant Nutrition" },
    { id: "dla1", lectureType: "DLA", lectureNumber: 1, lectureTitle: "Nutrition and Aging" },
  ];

  const doc = [
    "| DLA PHYS | Nutrition & Aging |",
    "| SOM.MK.III.BPM2.2.ER.3.BCHM.1008 | Review protein-energy malnutrition (PEM) in older adults and describe its management. |",
    "| Lecture BCHM | Nutritional Aspects of Pregnancy, Lactation and Infant Nutrition |",
    "| SOM.MK.III.BPM2.2.ER.3.BCHM.1010 | Explain the role of docosahexaenoic acid in brain growth and neurodevelopment. |",
    "| SOM.MK.III.BPM2.2.ER.3.BCHM.1011 | Compare the macronutrients in human breast milk and cow's milk. |",
  ].join("\n");

  it("keeps a DLA section on the DLA", async () => {
    const objs = await extractObjectivesFromStandaloneDoc(doc, lectures, "b1");
    const pem = objs.find((o) => o.code.endsWith("1008"));

    expect(pem.linkedLecId).toBe("dla1");
    expect(pem.activity).toBe("DLA");
  });

  it("leaves a DLA section unlinked rather than binding it to a lecture that shares a word", async () => {
    // The DLA has not been uploaded yet — only the lecture is in the block. A
    // title-only match would hand every aging objective to LEC 23 on "nutrition".
    const lectureOnly = lectures.filter((l) => l.lectureType === "LEC");

    const objs = await extractObjectivesFromStandaloneDoc(doc, lectureOnly, "b1");
    const pem = objs.find((o) => o.code.endsWith("1008"));

    expect(pem.linkedLecId).toBe("imported");
    expect(pem.activity).toBe("DLA");
  });

  it("still matches the lecture section to its lecture", async () => {
    const objs = await extractObjectivesFromStandaloneDoc(doc, lectures, "b1");

    expect(objs.find((o) => o.code.endsWith("1010")).linkedLecId).toBe("lec23");
    expect(objs.find((o) => o.code.endsWith("1011")).linkedLecId).toBe("lec23");
  });
});
