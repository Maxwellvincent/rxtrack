// ocrExtract.js — OCR orchestrator. Tiered fallback:
//   1. local marker server (GPU, free)  ->  2. Datalab hosted (paid)  ->  3. Mistral (existing)
// Exposes the SAME two shapes RxTrack already consumes, so call sites swap 1:1:
//   extractTextSmart(file)      -> { chunks, slideImages }      (was extractTextWithMistral)
//   extractPDFSmartSafe(file)   -> { markdown, pageCount, pages, slideImages } | null
//                                  (was extractPDFWithMistralSafe)

import { isLocalMarkerUp, extractWithLocalMarker } from "./markerLocal";
import { hasDatalabKey, extractWithDatalab } from "./markerDatalab";
import { extractTextWithMistral, extractPDFWithMistral } from "./mistralOCR";

const hasMistral = () => !!import.meta.env.VITE_MISTRAL_API_KEY;

/**
 * Run the tiered chain; returns the first provider's normalized result plus `method`.
 * @returns { markdown, chunks, slideImages, pageCount, method }
 * @throws only if every available provider fails.
 */
export async function runOcrChain(file, opts = {}) {
  const { onProgress, forceOcr = true, useLlm = false } = opts;
  const errors = [];

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

  // 2) Datalab hosted marker.
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
