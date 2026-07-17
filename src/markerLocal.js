// markerLocal.js — talk to the local marker FastAPI server (GPU) at localhost:8000.
// Free, best quality, but only reachable when the server is running on the same machine.
// The server already returns the normalized {markdown, chunks, slideImages, pageCount} shape.

const BASE =
  import.meta.env.VITE_MARKER_LOCAL_URL || "http://localhost:8000";

/** Quick reachability probe so we can fall through fast when the server is down. */
export async function isLocalMarkerUp(timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${BASE}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const j = await res.json();
    return j?.status === "ok";
  } catch {
    return false;
  }
}

/**
 * OCR a file via the local marker server.
 * @returns { markdown, chunks, slideImages, pageCount, method }
 * @throws on server error / unreachable / timeout.
 */
export async function extractWithLocalMarker(file, opts = {}) {
  const { forceOcr = true, useLlm = false, timeoutMs = 300000 } = opts;
  const params = new URLSearchParams({
    force_ocr: String(forceOcr),
    use_llm: String(useLlm),
  });
  const form = new FormData();
  form.append("file", file, file.name);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}/ocr?${params}`, {
      method: "POST",
      body: form,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json())?.error || "";
    } catch {
      /* ignore */
    }
    throw new Error(`Local marker failed: ${res.status} ${detail}`);
  }
  const data = await res.json();
  if (data?.error) throw new Error(`Local marker error: ${data.error}`);
  if (!data?.markdown && !(data?.chunks?.length)) {
    throw new Error("Local marker returned empty result");
  }
  return { ...data, method: "marker-local" };
}
