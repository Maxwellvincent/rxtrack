// ocrExtract.js — OCR orchestrator. Tiered fallback:
//   1. local marker server (GPU, free)  ->  2. Datalab hosted (paid)  ->  3. Mistral (existing)
// Exposes the SAME two shapes RxTrack already consumes, so call sites swap 1:1:
//   extractTextSmart(file)      -> { chunks, slideImages }      (was extractTextWithMistral)
//   extractPDFSmartSafe(file)   -> { markdown, pageCount, pages, slideImages } | null
//                                  (was extractPDFWithMistralSafe)

import { isLocalMarkerUp, extractWithLocalMarker } from "./markerLocal";
import { hasDatalabKey, extractWithDatalab } from "./markerDatalab";
import { canUseDatalabProxy, extractWithDatalabProxy } from "./markerDatalabProxy";
import { extractTextWithMistral, extractPDFWithMistral } from "./mistralOCR";
import { normalizeMarkerResult } from "./ocrShared";
import { bridgePdf2md } from "./llmBridge";

const isTextUpload = (file) => {
  const n = (file?.name || "").toLowerCase();
  return (
    n.endsWith(".md") ||
    n.endsWith(".markdown") ||
    n.endsWith(".txt") ||
    file?.type === "text/markdown" ||
    file?.type === "text/plain"
  );
};

const hasMistral = () => !!import.meta.env.VITE_MISTRAL_API_KEY;

/**
 * The local pdf2md bridge runs Poppler's `pdftotext -layout` fast path before
 * Marker.  Keep the native text layer as one chunk per PDF page so lecture
 * objectives and tiny qualifiers retain their page provenance.  The bridge
 * wrapper puts the fast output in a fenced text block. The heading check below
 * intentionally rejects Marker-rich Markdown, because that path should retain
 * its OCR/image handling instead of being reduced to text only.
 */
function normalizeNativePdfText(markdown) {
  const source = String(markdown || "");
  // The wrapper's native fast path starts with this heading. If Marker had to
  // run first, it appends the layout text to a richer Markdown document; let
  // the normal OCR provider handle that case so figures and OCR-only labels
  // are not silently discarded.
  if (!/^\s*# Layout-preserved PDF text\b/i.test(source)) return null;
  const fenced = source.match(/```text\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : source)
    .replace(/^# Layout-preserved PDF text\s*/i, "")
    .trim();
  if (!body) return null;
  const pages = body.split(/\f/).map((text, index) => ({
    pageNumber: index + 1,
    markdown: text.trim(),
  })).filter((page) => page.markdown);
  if (!pages.length) return null;
  const chunks = pages.map((page) => ({
    text: page.markdown,
    markdown: page.markdown,
    pageNumber: page.pageNumber,
    hasTable: /\S\s{2,}\S/.test(page.markdown),
    hasBold: false,
  }));
  return {
    markdown: pages.map((page) => page.markdown).join("\n\n---\n\n"),
    chunks,
    slideImages: [],
    pageCount: chunks.length,
    method: "pdftotext",
  };
}

async function extractWithNativePdfText(file, onProgress) {
  const name = String(file?.name || "").toLowerCase();
  if (!file || (!name.endsWith(".pdf") && file.type !== "application/pdf")) return null;
  onProgress?.("⚡ Reading the PDF text layer (pdftotext)…");
  const markdown = await bridgePdf2md(file);
  const result = normalizeNativePdfText(markdown);
  if (!result) return null;
  const quality = result.markdown.replace(/\s+/g, " ").trim().length;
  // The wrapper only chooses its fast path for healthy text PDFs. Keep a
  // conservative guard in case a stale bridge returns an empty/scanned deck.
  if (quality < 100) return null;
  return result;
}

/**
 * Run the tiered chain; returns the first provider's normalized result plus `method`.
 * @returns { markdown, chunks, slideImages, pageCount, method }
 * @throws only if every available provider fails.
 */
export async function runOcrChain(file, opts = {}) {
  const { onProgress, forceOcr = true, useLlm = false, userId = null, useNativeText = true } = opts;
  const errors = [];

  // 0) Markdown/text upload (e.g. pre-verified marker OCR output) — no OCR needed.
  //    Reuses the same md→pages→chunks normalizer as marker, so every caller
  //    (lecture, exam, question bank) gets identical chunk/slideImage shapes.
  if (isTextUpload(file)) {
    onProgress?.("📄 Reading markdown/text…");
    const text = await file.text();
    if (!text || text.trim().length < 100) {
      throw new Error("Markdown/text file is empty or too short (< 100 chars)");
    }
    return normalizeMarkerResult(text, {}, { method: "md-upload" });
  }

  // Native Poppler text is the highest-fidelity/lowest-cost path for ordinary
  // lecture PDFs. It preserves exact spelling, symbols, columns, and page
  // breaks; Marker/Mistral remain fallbacks for scanned or image-only pages.
  if (useNativeText) {
    try {
      const native = await extractWithNativePdfText(file, onProgress);
      if (native) return native;
    } catch (e) {
      console.warn("Native pdftotext bridge failed, falling back:", e);
      errors.push(`pdftotext: ${e.message}`);
    }
  }

  // 1) Local marker (only if the server answers a fast health probe).
  try {
    if (await isLocalMarkerUp()) {
      onProgress?.("🖥️ Local marker (GPU)…");
      return await extractWithLocalMarker(file, { forceOcr, useLlm });
    }
  } catch (e) {
    console.warn("Local marker failed, falling back:", e);
    errors.push(`local: ${e.message}`);
  }

  // 2) Datalab through our Cloud Function. This is the one that works from a
  //    browser — datalab.to sends no CORS headers, so the direct call below can
  //    only ever fail with "Failed to fetch" from a page.
  if (canUseDatalabProxy(userId)) {
    try {
      return await extractWithDatalabProxy(file, { userId, onProgress, forceOcr, useLlm });
    } catch (e) {
      console.warn("Datalab proxy failed, falling back:", e);
      errors.push(`datalab-proxy: ${e.message}`);
    }
  }

  // 2b) Direct Datalab — only reachable outside a browser (tests, Node scripts).
  if (hasDatalabKey()) {
    try {
      onProgress?.("☁️ Datalab marker…");
      return await extractWithDatalab(file, { forceOcr, useLlm });
    } catch (e) {
      console.warn("Datalab failed, falling back:", e);
      errors.push(`datalab: ${e.message}`);
    }
  }

  // 3) Mistral OCR (existing).
  if (hasMistral()) {
    try {
      onProgress?.("🔍 Mistral OCR…");
      const { chunks, slideImages } = await extractTextWithMistral(file);
      const markdown = chunks.map((c) => c.markdown || c.text || "").join("\n\n---\n\n").trim();
      return { markdown, chunks, slideImages, pageCount: chunks.length, method: "mistral-ocr" };
    } catch (e) {
      console.warn("Mistral OCR failed:", e);
      errors.push(`mistral: ${e.message}`);
    }
  }

  throw new Error(`All OCR providers failed: ${errors.join(" | ") || "none configured"}`);
}

/** Drop-in for extractTextWithMistral. Returns { chunks, slideImages } (+ method). */
export async function extractTextSmart(file, opts = {}) {
  const r = await runOcrChain(file, opts);
  return { chunks: r.chunks || [], slideImages: r.slideImages || [], method: r.method };
}

/**
 * Drop-in for extractPDFWithMistralSafe. Returns null on total failure (never throws).
 * `pages` mirrors chunks for callers that read either.
 */
export async function extractPDFSmartSafe(file, opts = {}) {
  try {
    const r = await runOcrChain(file, opts);
    return {
      markdown: r.markdown || "",
      pageCount: r.pageCount ?? (r.chunks?.length || 0),
      pages: r.chunks || [],
      slideImages: r.slideImages || [],
      method: r.method,
    };
  } catch (e) {
    console.warn("extractPDFSmartSafe: all providers failed:", e);
    // Last-ditch: try raw Mistral markdown extractor if present (kept for parity).
    if (hasMistral()) {
      try {
        return await extractPDFWithMistral(file);
      } catch {
        /* ignore */
      }
    }
    return null;
  }
}

/** True if ANY OCR provider is available (local can't be known sync; assume possible). */
export function anyOcrAvailable() {
  return true; // local server may be up; Datalab/Mistral gated by keys at call time
}
