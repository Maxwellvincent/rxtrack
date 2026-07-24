import { useState, useCallback } from "react";
import { Button } from "../ui/Button.jsx";
import { callAIJSON } from "../aiClient.js";
import { extractTypedHighYield } from "../engine/extractHighYield.js";
import { HY_TYPES } from "../engine/highYield.js";

const TYPE_META = {
  definition: { label: "Definitions", hint: "what it is", accent: "border-l-accent" },
  mechanism: { label: "Mechanisms", hint: "how it works", accent: "border-l-good" },
  relationship: { label: "Relationships", hint: "how things relate", accent: "border-l-accent" },
  result: { label: "Results", hint: "the outcome", accent: "border-l-bad" },
};

export function LectureExtractModal({ onClose }) {
  const [fileName, setFileName] = useState("");
  const [atoms, setAtoms] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = useCallback(async (file) => {
    setError(""); setAtoms(null); setFileName(file?.name || "");
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const title = file.name.replace(/\.[^.]+$/, "");
      const r = await extractTypedHighYield(text, { lectureTitle: title }, { callAIJSON });
      if (r.error) setError(r.error);
      setAtoms(r.atoms || []);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }, []);

  const byType = (t) => (atoms || []).filter((a) => a.type === t);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Extract lecture signal</div>
        <div className="mb-4 text-xs text-text-3">
          Upload a lecture <b>.md</b> (from pdf2md). Pulls the testable signal — definitions, mechanisms, relationships, results — and drops the fluff.
        </div>

        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{fileName || "Choose lecture .md / .txt"}</span>
          <span className="font-mono text-[10px] text-text-3">{busy ? "extracting…" : "browse"}</span>
          <input type="file" accept=".md,.markdown,.txt" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(f); }} />
        </label>

        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}

        {atoms && !error && (
          <div className="space-y-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-3">{atoms.length} high-yield atoms</div>
            {HY_TYPES.map((t) => {
              const list = byType(t);
              if (!list.length) return null;
              const m = TYPE_META[t];
              return (
                <div key={t}>
                  <div className="mb-1.5 text-sm font-semibold text-text-1">
                    {m.label} <span className="font-normal text-text-3">· {m.hint} · {list.length}</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {list.map((a, i) => (
                      <div key={i} className={"rounded-lg border-l-2 bg-bg-elevated px-3 py-2 text-xs " + m.accent}>
                        <span className="font-semibold text-text-1">{a.term}</span>
                        <span className="text-text-2"> — {a.content}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-5"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}
