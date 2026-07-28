import { describe, expect, it, vi, beforeEach } from "vitest";

const extractTextSmart = vi.fn();
const parseExamPDF = vi.fn();
const loadPDFJS = vi.fn(async () => {});

vi.mock("../ocrExtract", () => ({ extractTextSmart: (...a) => extractTextSmart(...a) }));
vi.mock("../examParser", () => ({
  loadPDFJS: (...a) => loadPDFJS(...a),
  parseExamPDF: (...a) => parseExamPDF(...a),
}));

const { assessTextQuality, extractionMethodSuffix, extractWithSmartFallback } = await import("./pdfText.js");

/** A File-alike with the surface the extractor touches. */
function fakePdf(name = "MSK LEC 03 - The Back.pdf") {
  return { name, type: "application/pdf", arrayBuffer: async () => new ArrayBuffer(8) };
}

/** Stub pdf.js so the direct-text probe returns `text` for a single page. */
function stubPdfJs(text) {
  globalThis.window = globalThis.window || {};
  window.pdfjsLib = {
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: text, hasEOL: true }] }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  extractTextSmart.mockReset();
  parseExamPDF.mockReset();
  loadPDFJS.mockClear();
});

describe("assessTextQuality", () => {
  it("calls an empty or near-empty extraction empty", () => {
    expect(assessTextQuality("")).toEqual({ quality: "empty", reason: "No text extracted" });
    expect(assessTextQuality("too short").quality).toBe("empty");
  });

  it("flags a page with barely any words as poor", () => {
    // Over the 50-char length gate but under the 20-word gate.
    expect(assessTextQuality("alpha beta gamma delta epsilon zeta eta theta iota")).toMatchObject({
      quality: "poor",
      reason: "Very little text — may be image-based",
    });
  });

  it("flags garbled text with no word breaks", () => {
    expect(assessTextQuality(("x".repeat(30) + " ").repeat(25)).quality).toBe("poor");
  });

  it("flags text that is mostly symbols", () => {
    const symbols = "§¤¤§¤§¤¤§".repeat(30);
    expect(assessTextQuality(symbols + " one two three four five six").quality).toBe("poor");
  });

  it("passes ordinary lecture prose", () => {
    const prose =
      "The vertebral column consists of thirty three vertebrae arranged in five regions, " +
      "namely cervical, thoracic, lumbar, sacral and coccygeal segments of the spine.";
    expect(assessTextQuality(prose)).toEqual({ quality: "good", reason: null });
  });
});

describe("extractionMethodSuffix", () => {
  it("labels the methods that have a label", () => {
    expect(extractionMethodSuffix("pdfplumber")).toBe("direct extract");
    expect(extractionMethodSuffix("marker-local")).toBe("marker (GPU)");
    expect(extractionMethodSuffix("marker-datalab")).toBe("marker (cloud)");
  });

  it("says nothing for a failed or unknown extraction", () => {
    expect(extractionMethodSuffix("none")).toBeNull();
    expect(extractionMethodSuffix("error")).toBeNull();
    expect(extractionMethodSuffix("something-else")).toBeNull();
  });
});

describe("extractWithSmartFallback", () => {
  it("uses OCR when it returns chunks, and never touches pdfplumber", async () => {
    extractTextSmart.mockResolvedValue({
      chunks: [{ markdown: "# The Back" }, { markdown: "Vertebrae" }],
      slideImages: ["img"],
      method: "marker-local",
    });

    const out = await extractWithSmartFallback(fakePdf(), null, {
      detectNumber: () => 3,
    });

    expect(out.method).toBe("marker-local");
    expect(out.contentResult.fullText).toBe("# The Back\n\n---\n\nVertebrae");
    expect(out.contentResult.chunks).toHaveLength(2);
    expect(out.contentResult.slideImages).toEqual(["img"]);
    expect(out.contentResult.pageCount).toBe(2);
    expect(out.contentResult.lectureNumber).toBe(3);
    expect(out.contentResult.lectureTitle).toBe("MSK LEC 03 - The Back");
    expect(parseExamPDF).not.toHaveBeenCalled();
  });

  it("leaves lectureNumber null when no detector is injected", async () => {
    extractTextSmart.mockResolvedValue({ chunks: [{ markdown: "text" }], method: "marker-ocr" });
    const out = await extractWithSmartFallback(fakePdf(), null);
    expect(out.contentResult.lectureNumber).toBeNull();
  });

  it("falls back to pdfplumber when OCR throws", async () => {
    extractTextSmart.mockRejectedValue(new Error("OCR service down"));
    stubPdfJs("x".repeat(200));
    parseExamPDF.mockResolvedValue({ fullText: "real text", chunks: [{ text: "a" }] });

    const out = await extractWithSmartFallback(fakePdf(), null);

    expect(out.method).toBe("pdfplumber");
    expect(out.contentResult.extractionMethod).toBe("pdfplumber");
    expect(out.contentResult.pageCount).toBe(1);
  });

  it("falls back when OCR succeeds but returns no usable markdown", async () => {
    extractTextSmart.mockResolvedValue({ chunks: [{ markdown: "   " }], method: "marker-ocr" });
    stubPdfJs("x".repeat(200));
    parseExamPDF.mockResolvedValue({ fullText: "real text", chunks: [] });

    const out = await extractWithSmartFallback(fakePdf(), null);
    expect(out.method).toBe("pdfplumber");
  });

  it("reports method 'none' for a scanned PDF nothing could read", async () => {
    extractTextSmart.mockRejectedValue(new Error("no text"));
    stubPdfJs("");
    parseExamPDF.mockResolvedValue({ fullText: "   ", chunks: [] });

    const out = await extractWithSmartFallback(fakePdf(), null);

    expect(out.method).toBe("none");
    expect(out.contentResult.extractionMethod).toBe("none");
  });
});
