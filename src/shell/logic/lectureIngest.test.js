import { describe, expect, it } from "vitest";
import {
  parseLectureFilename,
  chunkMarkdown,
  buildLectureRecord,
  buildLectureFromExtraction,
  upsertLecture,
  findFillTarget,
  fillLecture,
} from "./lectureIngest.js";

describe("parseLectureFilename", () => {
  it("reads type, number and title from the real naming pattern", () => {
    expect(parseLectureFilename("MSK Lecture 27 - Histology of the Skin.md")).toEqual({
      type: "LEC",
      number: 27,
      suffix: null,
      title: "Histology of the Skin",
    });
    expect(parseLectureFilename("DLA 07 - Development of the body cavities.pdf")).toMatchObject({
      type: "DLA",
      number: 7,
    });
  });

  it("splits a lettered number like 2a into a number and a suffix", () => {
    expect(parseLectureFilename("DLA 2a - Developmental Genetics.md")).toMatchObject({
      type: "DLA",
      number: 2,
      suffix: "a",
    });
  });

  it("does not read a number out of url-encoded punctuation", () => {
    // Downloaded straight from the course site: spaces are "+" and "&" is "%26",
    // whose digits used to win over the real lecture number.
    expect(
      parseLectureFilename("ER+DLA+2a-Developmental+Genetics-Terminology+%26+Sonic+Hedgehog.pdf")
    ).toMatchObject({ type: "DLA", number: 2, suffix: "a", title: "ER DLA 2a-Developmental Genetics-Terminology & Sonic Hedgehog" });
  });

  it("defaults to LEC and copes with no number", () => {
    expect(parseLectureFilename("Endocrine overview.md")).toMatchObject({ type: "LEC", number: null });
  });

  it("keeps the whole name as the title when there is no dash", () => {
    expect(parseLectureFilename("ER LEC 02.md").title).toBe("ER LEC 02");
  });

  it("survives an empty name", () => {
    expect(parseLectureFilename("")).toMatchObject({ type: "LEC", number: null });
  });
});

describe("chunkMarkdown", () => {
  it("splits on headings", () => {
    const chunks = chunkMarkdown("# One\nbody\n## Two\nmore\n### Three\nlast");
    expect(chunks).toHaveLength(3);
    expect(chunks[0].markdown).toContain("# One");
  });

  it("splits an oversized section on blank lines, not mid-sentence", () => {
    const para = "x".repeat(300);
    const chunks = chunkMarkdown(`# Big\n${Array(10).fill(para).join("\n\n")}`, { maxChars: 700 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.markdown.length <= 1000)).toBe(true);
  });

  it("handles text with no headings, and nothing at all", () => {
    expect(chunkMarkdown("just a paragraph")).toHaveLength(1);
    expect(chunkMarkdown("   ")).toEqual([]);
  });
});

describe("buildLectureRecord", () => {
  const text = "# Thyroid\n" + "content ".repeat(30);

  it("keeps the lettered part on the pdf path too", () => {
    const { lecture } = buildLectureFromExtraction({
      filename: "DLA 2a - Sonic Hedgehog.pdf",
      contentResult: { fullText: text, chunks: [{ markdown: text }] },
      blockId: "b1",
      idgen: () => "new-id",
    });

    expect(lecture).toMatchObject({ lectureType: "DLA", lectureNumber: 2, lectureSuffix: "a" });
  });

  it("keeps the lettered part of a split lecture on the record", () => {
    const { lecture } = buildLectureRecord({
      filename: "DLA 2b - Hox Genes.md",
      text,
      blockId: "b1",
      idgen: () => "new-id",
    });

    expect(lecture).toMatchObject({ lectureType: "DLA", lectureNumber: 2, lectureSuffix: "b" });
  });

  it("builds a record the rest of the app can read", () => {
    const { lecture } = buildLectureRecord({
      filename: "ER Lecture 04 - Thyroid.md",
      text,
      blockId: "b1",
      termId: "t1",
      idgen: () => "new-id",
    });

    expect(lecture).toMatchObject({
      id: "new-id",
      blockId: "b1",
      termId: "t1",
      lectureType: "LEC",
      lectureNumber: 4,
      lectureTitle: "Thyroid",
      extractionMethod: "markdown-upload",
    });
    expect(lecture.chunks[0].markdown).toContain("Thyroid");
  });

  it("refuses an empty file or a missing block", () => {
    expect(buildLectureRecord({ filename: "a.md", text: "hi", blockId: "b1" }).error).toMatch(/almost no text/);
    expect(buildLectureRecord({ filename: "a.md", text, blockId: null }).error).toMatch(/Pick a block/);
  });

  it("carries a lecture date when one is given", () => {
    const { lecture } = buildLectureRecord({ filename: "a.md", text, blockId: "b1", lectureDate: "2026-09-01" });
    expect(lecture.lectureDate).toBe("2026-09-01");
  });
});

describe("buildLectureFromExtraction", () => {
  const contentResult = {
    fullText: "Cortisol is released from the adrenal cortex under ACTH control, and much more besides.",
    chunks: [{ markdown: "# Adrenal" }, { markdown: "Cortisol" }],
    slideImages: ["slide1"],
    pageCount: 2,
    extractionMethod: "marker-local",
    lectureTitle: "ER LEC 06",
  };

  it("builds the same record shape the markdown path writes", () => {
    const { lecture } = buildLectureFromExtraction({
      filename: "ER LEC 06 - Adrenal Cortex.pdf",
      contentResult,
      method: "marker-local",
      blockId: "b1",
      termId: "t1",
      idgen: () => "pdf-id",
    });

    expect(lecture).toMatchObject({
      id: "pdf-id",
      blockId: "b1",
      termId: "t1",
      lectureType: "LEC",
      lectureNumber: 6,
      lectureTitle: "Adrenal Cortex",
      extractionMethod: "marker-local",
      pageCount: 2,
    });
    expect(lecture.chunks).toHaveLength(2);
    expect(lecture.slideImages).toEqual(["slide1"]);
    // No subtopics or keyTerms: the AI-guessed labels were cut — objectives and
    // the teaching map's own per-section terms carry that weight now.
    expect(lecture.subtopics).toBeUndefined();
    expect(lecture.keyTerms).toBeUndefined();
  });

  it("takes the extractor's title only when the filename is a bare slot", () => {
    const { lecture } = buildLectureFromExtraction({
      filename: "ER LEC 06.pdf",
      contentResult: { ...contentResult, lectureTitle: "The Adrenal Cortex" },
      blockId: "b1",
    });
    expect(lecture.lectureTitle).toBe("The Adrenal Cortex");
  });

  it("joins the chunks when the extractor gave no fullText", () => {
    const { lecture } = buildLectureFromExtraction({
      filename: "ER LEC 06 - Adrenal.pdf",
      contentResult: {
        chunks: [{ text: "Cortisol is released from the adrenal cortex" }, { text: "under ACTH control." }],
      },
      blockId: "b1",
    });
    expect(lecture.fullText).toBe("Cortisol is released from the adrenal cortex\n\nunder ACTH control.");
    expect(lecture.extractionMethod).toBe("pdf-upload");
  });

  it("names the scanned-PDF case instead of saving an empty lecture", () => {
    const scanned = buildLectureFromExtraction({
      filename: "ER LEC 06.pdf",
      contentResult: { fullText: "   ", chunks: [] },
      method: "none",
      blockId: "b1",
    });
    expect(scanned.error).toMatch(/scanned images/);
    expect(scanned.lecture).toBeUndefined();
  });

  it("refuses a missing block", () => {
    expect(buildLectureFromExtraction({ filename: "a.pdf", contentResult, blockId: null }).error).toMatch(
      /Pick a block/
    );
  });
});

describe("upsertLecture", () => {
  const existing = {
    id: "old",
    blockId: "b1",
    lectureType: "LEC",
    lectureNumber: 4,
    lectureTitle: "Thyroid",
  };
  const incoming = { ...existing, id: "new" };

  it("fills the row that is already in the slot, keeping its id", () => {
    const result = upsertLecture([existing], incoming);
    expect(result.action).toBe("filled");
    expect(result.filledId).toBe("old");
    expect(result.lectures.map((l) => l.id)).toEqual(["old"]);
  });

  it("still replaces when the caller asks for it", () => {
    const result = upsertLecture([existing], incoming, { mode: "replace" });
    expect(result).toMatchObject({ action: "replaced", replacedId: "old" });
    expect(result.lectures.map((l) => l.id)).toEqual(["new"]);
  });

  it("adds when the slot is free, and leaves other lectures alone", () => {
    const other = { id: "x", blockId: "b1", lectureType: "LEC", lectureNumber: 9, lectureTitle: "Other" };
    const result = upsertLecture([other], incoming);
    expect(result).toMatchObject({ action: "added", replacedId: null, filledId: null });
    expect(result.lectures.map((l) => l.id).sort()).toEqual(["new", "x"]);
  });

  it("leaves a different, already-populated lecture in the same slot alone", () => {
    const populated = { ...existing, chunks: [{ markdown: "real content" }] };
    const result = upsertLecture([populated], { ...incoming, lectureTitle: "Parathyroid" });
    expect(result.action).toBe("added");
    expect(result.lectures).toHaveLength(2);
  });
});

describe("findFillTarget / fillLecture — the schedule stub case", () => {
  // What schedule import actually writes: a filename like "ER LEC 02", no
  // title, real dates, no content.
  const stub = {
    id: "sched-2",
    blockId: "b1",
    lectureType: "LEC",
    lectureNumber: 2,
    filename: "ER LEC 02",
    lectureDate: "2026-08-12",
    weekNumber: 1,
    chunks: [],
  };
  const upload = {
    id: "fresh",
    blockId: "b1",
    lectureType: "LEC",
    lectureNumber: 2,
    lectureTitle: "Hypothalamus",
    filename: "Lecture 02 - Hypothalamus.md",
    chunks: [{ markdown: "# Hypothalamus" }],
    lectureDate: null,
  };

  it("finds the untitled stub that a title comparison would miss", () => {
    expect(findFillTarget([stub], upload)).toBe(stub);
  });

  it("matches a row that kept the whole filename as its title", () => {
    // Real data: an older upload stored "Lecture 01 - Endocrine System" while
    // the parser yields "Endocrine System". Same lecture, and it already has
    // content, so the empty-stub fallback would not save it.
    const populated = {
      id: "old-1",
      blockId: "b1",
      lectureType: "LEC",
      lectureNumber: 1,
      lectureTitle: "Lecture 01 - Endocrine System",
      chunks: [{ markdown: "old content" }],
    };
    const incoming = {
      id: "fresh",
      blockId: "b1",
      lectureType: "LEC",
      lectureNumber: 1,
      lectureTitle: "Endocrine System",
    };
    expect(findFillTarget([populated], incoming)).toBe(populated);
    expect(fillLecture(populated, incoming).lectureTitle).toBe("Lecture 01 - Endocrine System");
  });

  it("still refuses to merge two genuinely different lectures in one slot", () => {
    const populated = {
      id: "old-1",
      blockId: "b1",
      lectureType: "LEC",
      lectureNumber: 1,
      lectureTitle: "Adrenal Glands",
      chunks: [{ markdown: "content" }],
    };
    const incoming = { id: "fresh", blockId: "b1", lectureType: "LEC", lectureNumber: 1, lectureTitle: "Thyroid" };
    expect(findFillTarget([populated], incoming)).toBeNull();
  });

  it("keeps the schedule's date and week, and takes the title from the upload", () => {
    const merged = fillLecture(stub, upload);
    expect(merged).toMatchObject({
      id: "sched-2",
      lectureDate: "2026-08-12",
      weekNumber: 1,
      lectureTitle: "Hypothalamus",
    });
    expect(merged.chunks).toHaveLength(1);
  });

  it("does not let an upload with no date blank out the scheduled one", () => {
    expect(fillLecture(stub, { ...upload, lectureDate: null }).lectureDate).toBe("2026-08-12");
    expect(fillLecture(stub, { ...upload, lectureDate: "" }).lectureDate).toBe("2026-08-12");
  });

  it("accepts a date the upload does carry", () => {
    expect(fillLecture(stub, { ...upload, lectureDate: "2026-09-01" }).lectureDate).toBe("2026-09-01");
  });

  it("keeps a title the schedule already had rather than the parsed one", () => {
    const titled = { ...stub, lectureTitle: "Hypothalamic-Pituitary Axis" };
    expect(fillLecture(titled, upload).lectureTitle).toBe("Hypothalamic-Pituitary Axis");
  });

  it("upsert fills the stub in place, so nothing pointing at it is orphaned", () => {
    const result = upsertLecture([stub], upload);
    expect(result).toMatchObject({ action: "filled", filledId: "sched-2", replacedId: null });
    expect(result.lectures).toHaveLength(1);
    expect(result.lectures[0]).toMatchObject({ id: "sched-2", lectureDate: "2026-08-12" });
  });
});
