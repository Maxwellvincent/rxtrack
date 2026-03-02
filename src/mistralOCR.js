import { Mistral } from "@mistralai/mistralai";

const client = new Mistral({
  apiKey: import.meta.env.VITE_MISTRAL_API_KEY,
});

/**
 * Convert a PDF File object to rich markdown via Mistral OCR.
 * Returns concatenated markdown string from all pages.
 */
export async function extractPDFWithMistral(file) {
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const response = await client.ocr.process({
    model: "mistral-ocr-latest",
    document: {
      type: "document_url",
      documentUrl: `data:application/pdf;base64,${base64}`,
    },
    tableFormat: "markdown",
    includeImageBase64: false,
    extractHeader: true,
    extractFooter: false,
  });

  const pages = response.pages || [];
  const markdown = pages
    .map((p, i) => {
      const header = p.header ? `${p.header}\n\n` : "";
      return `${header}${p.markdown || ""}`;
    })
    .join("\n\n---\n\n");

  return {
    markdown,
    pageCount: pages.length,
    pages,
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
