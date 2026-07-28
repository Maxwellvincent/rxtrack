/**
 * SP1 T6.1 — PDF text extraction, lifted out of App.jsx unchanged.
 *
 * This is the first layer of App's upload pipeline: file in, text/chunks out.
 * It has no App state in it, so both shells can call it. What follows extraction
 * lives in ./objectives.js and ./teachingMap.js.
 */
import { loadPDFJS, parseExamPDF } from "../examParser";
import { extractTextSmart } from "../ocrExtract";

/** Judge extracted text before spending an AI call on it. */
export function assessTextQuality(text) {
  if (!text || text.trim().length < 50) {
    return { quality: "empty", reason: "No text extracted" };
  }
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const avgWordLength = text.replace(/\s+/g, "").length / Math.max(1, wordCount);
  if (wordCount < 20) {
    return {
      quality: "poor",
      reason: "Very little text — may be image-based",
    };
  }
  if (Number.isFinite(avgWordLength) && avgWordLength > 25) {
    return {
      quality: "poor",
      reason: "Text may be garbled",
    };
  }
  const specialCharRatio =
    (text.match(/[^a-zA-Z0-9\s.,;:!?()-]/g) || []).length / Math.max(1, text.length);
  if (specialCharRatio > 0.3) {
    return {
      quality: "poor",
      reason: "Text may be garbled",
    };
  }
  return { quality: "good", reason: null };
}

/** Human label for an extraction method, or null when there is nothing to say. */
export function extractionMethodSuffix(method) {
  if (method === "pdfplumber") return "direct extract";
  if (method === "mistral-ocr") return "OCR";
  if (method === "marker-local") return "marker (GPU)";
  if (method === "marker-datalab") return "marker (cloud)";
  if (method === "marker-ocr") return "marker";
  if (method === "none" || method === "error") return null;
  return null;
}

/** Fast PDF text probe (pdf.js) — same extraction approach as examParser, no question AI */
export async function extractPdfTextFast(file) {
  await loadPDFJS();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer, verbosity: 0 }).promise;
  const parts = [];
  const maxPages = Math.min(pdf.numPages, 80);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((x) => x.str + (x.hasEOL ? "\n" : " ")).join("").trim();
    parts.push(text);
  }
  return parts.join("\n\n");
}

/**
 * OCR (marker → datalab → mistral) first; on failure or empty output fall back
 * to pdfplumber via parseExamPDF.
 *
 * `detectNumber(fileName, title, type)` is injected because the two callers
 * number lectures differently — App has its own filename heuristics, the shell
 * reads the number off the filename in lectureIngest.
 */
export async function extractWithSmartFallback(file, onProgress, opts = {}) {
  void opts?.forceMistralOcr;
  const detectNumber = opts?.detectNumber;

  {
    try {
      onProgress?.("🔍 Running OCR...");
      console.log("Attempting OCR (marker → datalab → mistral)...");
      const ocrExtract = await extractTextSmart(file, { onProgress });
      const chunks = ocrExtract.chunks || ocrExtract;
      const slideImages = ocrExtract.slideImages || [];
      console.log("OCR success, chunks:", chunks.length, "method:", ocrExtract.method);
      const md = chunks.map((c) => c.markdown || c.text || "").join("\n\n---\n\n").trim();
      if (chunks?.length && md) {
        const extractionMethod = ocrExtract.method || "marker-ocr";
        const baseName = file.name.replace(/\.pdf$/i, "");
        return {
          contentResult: {
            fullText: md,
            chunks,
            slideImages,
            extractionMethod,
            pageCount: chunks.length,
            questions: [],
            examTitle: baseName,
            totalQuestions: 0,
            format: "standard",
            subtopics: [],
            keyTerms: [],
            lectureNumber: detectNumber ? detectNumber(file.name, baseName, "LEC") : null,
            lectureTitle: baseName,
          },
          method: extractionMethod,
        };
      }
    } catch (err) {
      console.warn("OCR failed, falling back to pdfplumber:", err?.message || err);
    }
  }

  const directText = await extractPdfTextFast(file);
  if (directText && directText.trim().length > 100) {
    const parsed = await parseExamPDF(file, onProgress);
    return {
      contentResult: {
        ...parsed,
        extractionMethod: "pdfplumber",
        pageCount: (parsed.chunks || []).length,
      },
      method: "pdfplumber",
    };
  }
  const parsed = await parseExamPDF(file, onProgress);
  const hasText = (parsed.fullText || "").trim().length > 0;
  return {
    contentResult: {
      ...parsed,
      extractionMethod: hasText ? "pdfplumber" : "none",
      pageCount: (parsed.chunks || []).length,
    },
    method: hasText ? "pdfplumber" : "none",
  };
}
