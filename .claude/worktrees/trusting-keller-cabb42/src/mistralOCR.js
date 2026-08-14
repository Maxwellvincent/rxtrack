import { Mistral } from "@mistralai/mistralai";

const client = new Mistral({
  apiKey: import.meta.env.VITE_MISTRAL_API_KEY,
});

/**
 * Plain-text-ish string for search / matching (strips common markdown noise).
 * Keeps table pipes so pipe-based parsers still work on `text` if needed.
 */
export function stripMarkdownForSearch(md) {
  if (!md) return "";
  let s = String(md);
  s = s.replace(/!\[[^\]]*]\([^)]*\)/g, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/`+/g, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Convert Mistral table payloads to markdown when not already a string.
 */
function convertTableToMarkdown(tableObj) {
  if (tableObj == null) return "";
  if (typeof tableObj === "string") return tableObj;
  if (tableObj.markdown) return tableObj.markdown;
  if (tableObj.html) {
    return tableObj.html
      .replace(/<tr>/gi, "\n")
      .replace(/<td[^>]*>/gi, " | ")
      .replace(/<th[^>]*>/gi, " | ")
      .replace(/<\/t[dh]>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();
  }
  if (tableObj.cells) {
    return tableObj.cells
      .map((row) => {
        if (Array.isArray(row)) return "| " + row.map(String).join(" | ") + " |";
        return "| " + String(row) + " |";
      })
      .join("\n");
  }
  return "";
}

/**
 * Merge table payloads from Mistral response into markdown when [tbl-N.md] refs appear.
 */
function resolveTableReferences(pageMarkdown, page) {
  const tableData =
    page?.tables ||
    page?.structured_content?.tables ||
    page?.structured_content?.table ||
    page?.extracted_tables ||
    null;

  if (!pageMarkdown || !pageMarkdown.includes("[tbl-")) return pageMarkdown;

  let resolved = pageMarkdown;
  const tableRefs = pageMarkdown.match(/\[tbl-(\d+)\.md\]/g) || [];

  tableRefs.forEach((ref, idx) => {
    const m = ref.match(/tbl-(\d+)\.md/);
    const tableIdx = m ? parseInt(m[1], 10) : idx;
    let table = null;
    if (Array.isArray(tableData)) {
      table = tableData[tableIdx] ?? tableData[idx];
    } else if (tableData && typeof tableData === "object") {
      table = tableData[tableIdx] ?? tableData[String(tableIdx)] ?? tableData[idx];
    }
    if (table) {
      const tableMarkdown = typeof table === "string" ? table : convertTableToMarkdown(table);
      if (tableMarkdown) resolved = resolved.replace(ref, tableMarkdown);
    }
  });

  return resolved;
}

/**
 * One-time diagnostic: log shape of first page that still contains [tbl- after API response.
 */
function logMistralTableRefPageStructure(pages) {
  const tableRefPage = pages?.find((p) => p?.markdown?.includes("[tbl-"));
  if (!tableRefPage) return;
  console.log("Mistral table ref page structure:", {
    markdownPreview: tableRefPage.markdown?.slice(0, 200),
    pageKeys: Object.keys(tableRefPage),
    hasTables: !!tableRefPage.tables,
    hasImages: !!tableRefPage.images,
    hasStructured: !!tableRefPage.structured_content,
    tablesValue: tableRefPage.tables,
  });
}

/**
 * Apply table reference resolution to each page; log response shape once if needed.
 */
function postProcessMistralPages(pages) {
  if (!Array.isArray(pages)) return [];
  logMistralTableRefPageStructure(pages);
  return pages.map((p) => ({
    ...p,
    markdown: resolveTableReferences(p?.markdown || "", p),
  }));
}

/** Plain text for chunk `text` field: strip bold + header markers (Mistral markdown OCR). */
function markdownToChunkPlainText(markdownText) {
  if (!markdownText) return "";
  return String(markdownText)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .trim();
}

/**
 * One lecture chunk from a Mistral OCR page (markdown preserved).
 */
export function ocrPageToLectureChunk(page) {
  const header = page?.header ? `${page.header}\n\n` : "";
  const markdownText = `${header}${page?.markdown || ""}`;
  const pageNumber = typeof page?.index === "number" ? page.index + 1 : undefined;
  const rawText = markdownToChunkPlainText(markdownText) || markdownText.trim();
  return {
    text: rawText,
    markdown: markdownText,
    pageNumber,
    hasTable: markdownText.includes("|"),
    hasBold: markdownText.includes("**"),
  };
}

/**
 * Collect slide images from Mistral OCR pages (markdown ![](img-N.ext) + page.images[]).
 */
export function extractSlideImagesFromMistralPages(pages) {
  if (!Array.isArray(pages)) return [];
  const images = [];
  pages.forEach((page, pageIdx) => {
    const md = page?.markdown || "";
    const imgRefs = md.match(/!\[[^\]]*]\((img-\d+\.\w+)\)/g) || [];
    imgRefs.forEach((ref) => {
      const filename = ref.match(/\(([^)]+)\)/)?.[1];
      if (!filename) return;
      const pageImages = page.images || [];
      const imgData = pageImages.find((img) => img.id === filename || img.filename === filename);
      const b64 = imgData?.image_base64 || imgData?.base64;
      if (!b64) return;
      const ext = (filename.split(".").pop() || "jpeg").toLowerCase();
      const mimeType =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
      const after = md.split(ref)[1] || "";
      const caption = after.split("\n")[0]?.replace(/^[_`*\s>]+/, "").trim() || "";
      images.push({
        filename,
        pageNumber: pageIdx + 1,
        base64: b64,
        mimeType,
        caption,
      });
    });
  });
  return images;
}

async function ocrViaFetch(file) {
  const apiKey = import.meta.env.VITE_MISTRAL_API_KEY;
  if (!apiKey) throw new Error("Missing VITE_MISTRAL_API_KEY");

  console.log("Mistral OCR: sending file:", file.name, "size:", file.size, "type:", file.type);

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("model", "mistral-ocr-latest");
  // Prefer inline markdown tables; omit table_format so default keeps tables in page markdown (not separate files).
  formData.append("include_image_base64", "false");
  formData.append("extract_header", "true");
  formData.append("extract_footer", "false");

  const response = await fetch("https://api.mistral.ai/v1/ocr", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral OCR failed: ${response.status} ${err}`);
  }

  return response.json();
}

/**
 * Convert a PDF File object to rich markdown via Mistral OCR.
 * Returns concatenated markdown string from all pages.
 */
export async function extractPDFWithMistral(file) {
  let response;
  try {
    response = await ocrViaFetch(file);
  } catch (fetchErr) {
    if (!import.meta.env.VITE_MISTRAL_API_KEY) throw fetchErr;
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    response = await client.ocr.process({
      model: "mistral-ocr-latest",
      document: {
        type: "document_url",
        documentUrl: `data:application/pdf;base64,${base64}`,
      },
      // Omit tableFormat — "markdown" can emit [tbl-N.md] file refs; default inlines tables in page markdown.
      includeImageBase64: false,
      extractHeader: true,
      extractFooter: false,
    });
  }

  const pages = postProcessMistralPages(response.pages || []);
  const markdown = pages
    .map((p) => {
      const header = p.header ? `${p.header}\n\n` : "";
      return `${header}${p.markdown || ""}`;
    })
    .join("\n\n---\n\n");

  const slideImages = extractSlideImagesFromMistralPages(pages);

  return {
    markdown,
    pageCount: pages.length,
    pages,
    slideImages,
  };
}

/**
 * Fallback: if Mistral OCR fails, return null so caller can
 * fall back to existing pdfplumber extraction.
 */
export async function extractPDFWithMistralSafe(file) {
  try {
    return await extractPDFWithMistral(file);
  } catch (err) {
    console.warn("Mistral OCR failed, falling back to pdfplumber:", err);
    return null;
  }
}

/**
 * OCR a PDF with Mistral; returns lecture chunks (throws on failure).
 * Used by the upload pipeline when VITE_MISTRAL_API_KEY is set.
 */
export async function extractTextWithMistral(file) {
  const result = await extractPDFWithMistral(file);
  const pages = result?.pages || [];
  const chunks = pages.map((p) => ocrPageToLectureChunk(p));
  const slideImages = result?.slideImages?.length
    ? result.slideImages
    : extractSlideImagesFromMistralPages(pages);
  return { chunks, slideImages };
}
