import { describe, expect, it } from "vitest";
import {
  parseLectureFilename,
  chunkMarkdown,
  buildLectureRecord,
  buildLectureFromExtraction,
  upsertLecture,
} from "./lectureIngest.js";

describe("parseLectureFilename", () => {
  it("reads type, number and title from the real naming pattern", () => {
    expect(parseLectureFilename("MSK Lecture 27 - Histology of the Skin.md")).toEqual({
      type: "LEC",
      number: 27,
      title: "Histology of the Skin",
    });
    expect(parseLectureFilename("DLA 07 - Development of the body cavities.pdf")).toMatchObject({
      type: "DLA",
      number: 7,
    });
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
    subtopics: ["Adrenal cortex"],
    keyTerms: ["cortisol"],
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
    expect(lecture.subtopics).toEqual(["Adrenal cortex"]);
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

  it("replaces the same slot instead of duplicating it", () => {
    const result = upsertLecture([existing], incoming);
    expect(result.action).toBe("replaced");
    expect(result.replacedId).toBe("old");
    expect(result.lectures.map((l) => l.id)).toEqual(["new"]);
  });

  it("adds when the slot is free, and leaves other lectures alone", () => {
    const other = { id: "x", blockId: "b1", lectureType: "LEC", lectureNumber: 9, lectureTitle: "Other" };
    const result = upsertLecture([other], incoming);
    expect(result).toMatchObject({ action: "added", replacedId: null });
    expect(result.lectures.map((l) => l.id).sort()).toEqual(["new", "x"]);
  });

  it("treats a different title in the same slot as a different lecture", () => {
    const result = upsertLecture([existing], { ...incoming, lectureTitle: "Parathyroid" });
    expect(result.action).toBe("added");
    expect(result.lectures).toHaveLength(2);
  });
});
