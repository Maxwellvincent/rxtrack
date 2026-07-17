// ocrShared.js — helpers shared across OCR providers (local marker, Datalab, Mistral).
// Normalizes any {markdown, images} into RxTrack's chunk/slideImage shape so every
// provider returns an identical contract:
//   { markdown, chunks:[{text,markdown,pageNumber,hasTable,hasBold}],
//     slideImages:[{filename,pageNumber,base64,mimeType,caption}], pageCount }

// marker page separator = "{<page_id>}" + ("-" * >=20). Matches datalab-marker output.
const PAGE_SPLIT = /\n*\{(\d+)\}-{20,}\n*/;

/** Split marker-style paginated markdown into [{pageNumber, markdown}]. */
export function splitMarkdownPages(markdown) {
  const md = String(markdown || "");
  if (!PAGE_SPLIT.test(md)) {
    const body = md.trim();
    return body ? [{ pageNumber: 1, markdown: body }] : [];
  }
  const parts = md.split(new RegExp(PAGE_SPLIT, "g")); // [pre, id, chunk, id, chunk...]
  const pages = [];
  let preamble = (parts[0] || "").trim();
  for (let i = 1; i < parts.length; i += 2) {
    const pageId = parts[i];
    let body = (parts[i + 1] || "").trim();
    let pageNumber = parseInt(pageId, 10);
    pageNumber = Number.isFinite(pageNumber) ? pageNumber + 1 : (i + 1) / 2;
    if (pageNumber === 1 && preamble) {
      body = (preamble + "\n\n" + body).trim();
      preamble = "";
    }
    pages.push({ pageNumber, markdown: body });
  }
  return pages;
}

function mdToPlainText(md) {
  return String(md || "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/#{1,6}\s/g, "")
    .trim();
}

/** Build lecture chunks from paginated markdown (matches ocrPageToLectureChunk shape). */
export function buildChunks(pages) {
  return pages.map((p) => ({
    text: mdToPlainText(p.markdown) || p.markdown,
    markdown: p.markdown,
    pageNumber: p.pageNumber,
    hasTable: p.markdown.includes("|"),
    hasBold: p.markdown.includes("**"),
  }));
}

/**
 * Build slideImages from an images map {filename: base64} + paginated markdown.
 * Finds the page each ![](filename) ref lives on and grabs the following line as caption.
 * base64 may be a raw base64 string or a data: URL; we store the raw base64 + mimeType.
 */
export function buildSlideImages(pages, images) {
  const out = [];
  if (!images) return out;
  for (const [filename, raw] of Object.entries(images)) {
    if (!raw) continue;
    let base64 = String(raw);
    let mimeType = "image/png";
    const dataMatch = base64.match(/^data:([^;]+);base64,(.*)$/s);
    if (dataMatch) {
      mimeType = dataMatch[1];
      base64 = dataMatch[2];
    } else {
      const ext = (filename.split(".").pop() || "png").toLowerCase();
      mimeType =
        ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
        ext === "webp" ? "image/webp" :
        ext === "gif" ? "image/gif" : "image/png";
    }
    let pageNumber = 1;
    let caption = "";
    const ref = `](${filename})`;
    for (const p of pages) {
      const pos = p.markdown.indexOf(ref);
      if (pos !== -1) {
        pageNumber = p.pageNumber;
        const after = p.markdown.slice(pos + ref.length);
        const nl = after.indexOf("\n");
        const line = nl !== -1 ? (after.slice(nl + 1).split("\n")[0] || "") : "";
        caption = line.replace(/^[_`*\s>]+/, "").trim();
        break;
      }
    }
    out.push({ filename, pageNumber, base64, mimeType, caption });
  }
  return out;
}

/** Normalize {markdown, images} into the full RxTrack OCR contract. */
export function normalizeMarkerResult(markdown, images, extra = {}) {
  const pages = splitMarkdownPages(markdown);
  const chunks = buildChunks(pages);
  const slideImages = buildSlideImages(pages, images);
  const fullMd = pages.map((p) => p.markdown).join("\n\n---\n\n").trim() || String(markdown || "");
  return { markdown: fullMd, chunks, slideImages, pageCount: pages.length, ...extra };
}
