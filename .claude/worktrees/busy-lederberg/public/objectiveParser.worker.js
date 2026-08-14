/**
 * Objectives PDF parser worker. Loads Pyodide in-browser, uses pdfplumber
 * to extract objectives with forward-fill logic. Streams progress by page.
 * On failure (e.g. Pyodide unavailable), main thread should use Gemini fallback.
 */
self.onmessage = async function (e) {
  const { type, pdfBytes, id: msgId } = e.data || {};
  if (type !== "parse" || !pdfBytes) return;

  const post = (payload) => self.postMessage({ ...payload, id: msgId });
  const postProgress = (page, total) => post({ type: "progress", page, total });
  const postDone = (objectives) => post({ type: "done", objectives });
  const postError = (error) => post({ type: "error", error: String(error) });

  try {
    const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs");
    postProgress(0, 1);
    const pyodide = await loadPyodide();

    await pyodide.loadPackage("micropip");
    await pyodide.runPythonAsync("import micropip");
    try {
      await pyodide.runPythonAsync("await micropip.install('pdfplumber')");
    } catch (pipErr) {
      throw new Error("pdfplumber not available in this environment: " + pipErr.message);
    }

    const bytes = new Uint8Array(pdfBytes);
    pyodide.FS.writeFile("/tmp/objectives.pdf", bytes);
    postProgress(1, 2);

    let lastPage = 0;
    pyodide.globals.set("__progress__", (page, total) => {
      if (page !== lastPage) {
        lastPage = page;
        postProgress(page, total);
      }
    });

    const pythonScript = `
import json
import pdfplumber
import re

def norm_activity(s):
    if not s or not str(s).strip(): return None
    s = str(s).strip()
    s = re.sub(r'Lecture\\s+(\\d+)', lambda m: 'Lec' + m.group(1), s, flags=re.I)
    s = re.sub(r'DLA\\s+(\\d+)', lambda m: 'DLA' + m.group(1), s, flags=re.I)
    s = re.sub(r'SG\\s+(\\d+)', lambda m: 'SG' + m.group(1), s, flags=re.I)
    return s

objectives = []
with pdfplumber.open("/tmp/objectives.pdf") as pdf:
    total_pages = len(pdf.pages)
    activity = None
    discipline = None
    title = None
    for page_num, page in enumerate(pdf.pages):
        # Progress is sent from JS after each page
        tables = page.extract_tables()
        for table in (tables or []):
            for row in (table or []):
                row = [str(c).strip() if c is not None else "" for c in (row or [])]
                if len(row) < 2:
                    continue
                a = norm_activity(row[0]) if row[0] else activity
                d = row[1] if row[1] else discipline
                t = row[2] if len(row) > 2 and row[2] else title
                if a: activity = a
                if d: discipline = d
                if t: title = t
                code = row[3] if len(row) > 3 else ""
                obj_text = row[4] if len(row) > 4 else (row[3] if len(row) > 3 else "")
                if not obj_text or len(obj_text) < 10:
                    continue
                objectives.append({
                    "activity": activity or "Unknown",
                    "lectureNumber": int(re.search(r"\\d+", str(activity or ""))) if activity else None,
                    "discipline": discipline or "Unknown",
                    "lectureTitle": title or "",
                    "code": code or None,
                    "objective": obj_text,
                })
        # Signal progress for this page (1-based)
        __progress__(page_num + 1, total_pages)
json.dumps(objectives)
`;

    const result = await pyodide.runPythonAsync(pythonScript);
    const raw = result?.toString?.() || String(result);
    let listObj = [];
    try {
      listObj = JSON.parse(raw);
    } catch {
      listObj = [];
    }

    const objectives = (listObj || []).map((o, i) => ({
      id: o.code || `imp_${Date.now()}_${i}`,
      activity: o.activity || "Unknown",
      lectureNumber: o.lectureNumber ?? (parseInt(String(o.activity || "").match(/\d+/)?.[0]) || null),
      discipline: o.discipline || "Unknown",
      lectureTitle: o.lectureTitle || o.title || "",
      code: o.code || null,
      objective: o.objective || o.text || "",
      status: "untested",
      confidence: 0,
      lastTested: null,
      quizScore: null,
      source: "imported",
    }));

    postDone(objectives);
  } catch (err) {
    postError(err?.message || err);
  }
};
