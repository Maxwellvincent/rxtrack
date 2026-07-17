// markerDatalab.js — hosted marker via Datalab /convert API (async submit + poll).
// Works from any device (paid, per-page). Requires VITE_DATALAB_API_KEY.
// Docs: POST https://www.datalab.to/api/v1/convert  (X-API-Key header)
//   -> { success, request_id, request_check_url }
//   poll request_check_url -> { status: processing|complete|failed, markdown, images:{fn:dataUrl} }

import { normalizeMarkerResult } from "./ocrShared";

const CONVERT_URL =
  import.meta.env.VITE_DATALAB_URL || "https://www.datalab.to/api/v1/convert";

export function hasDatalabKey() {
  return !!import.meta.env.VITE_DATALAB_API_KEY;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * OCR a file via Datalab hosted marker.
 * @returns { markdown, chunks, slideImages, pageCount, method }
 * @throws on missing key, submit error, poll timeout, or failed status.
 */
export async function extractWithDatalab(file, opts = {}) {
  const key = import.meta.env.VITE_DATALAB_API_KEY;
  if (!key) throw new Error("Missing VITE_DATALAB_API_KEY");
  const { forceOcr = true, useLlm = false, maxPollMs = 120000 } = opts;

  const form = new FormData();
  form.append("file", file, file.name);
  form.append("output_format", "markdown");
  form.append("paginate", "true");           // emit {N}----- page markers for splitting
  form.append("force_ocr", String(forceOcr));
  form.append("use_llm", String(useLlm));

  const submit = await fetch(CONVERT_URL, {
    method: "POST",
    headers: { "X-API-Key": key },
    body: form,
  });
  if (!submit.ok) {
    throw new Error(`Datalab submit failed: ${submit.status} ${await submit.text()}`);
  }
  const init = await submit.json();
  if (!init?.success || !init?.request_check_url) {
    throw new Error(`Datalab submit rejected: ${JSON.stringify(init)}`);
  }

  // Poll the check URL until complete / failed / timeout.
  const deadline = Date.now() + maxPollMs;
  let delay = 2000;
  while (Date.now() < deadline) {
    await sleep(delay);
    const check = await fetch(init.request_check_url, {
      headers: { "X-API-Key": key },
    });
    if (!check.ok) {
      delay = Math.min(delay * 1.5, 8000);
      continue; // transient — keep polling
    }
    const data = await check.json();
    if (data?.status === "complete") {
      if (!data.markdown) throw new Error("Datalab completed with empty markdown");
      return normalizeMarkerResult(data.markdown, data.images || {}, {
        method: "marker-datalab",
      });
    }
    if (data?.status === "failed") {
      throw new Error(`Datalab conversion failed: ${data?.error || "unknown"}`);
    }
    delay = Math.min(delay * 1.25, 6000);
  }
  throw new Error("Datalab poll timed out");
}
