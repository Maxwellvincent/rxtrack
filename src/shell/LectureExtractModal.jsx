import { useState, useCallback } from "react";
import { Button } from "../ui/Button.jsx";
import { callAIJSON } from "../aiClient.js";
import { extractTypedHighYield } from "../engine/extractHighYield.js";
import { HY_TYPES } from "../engine/highYield.js";
import { generateFromAtoms } from "../engine/mcq.js";

function readExemplars() {
  try {
    const banks = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
    return Object.values(banks).flat().filter((q) => q && q.stem && q.choices).slice(0, 5);
  } catch { return []; }
}

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
  const [quiz, setQuiz] = useState(null); // generated questions from atoms
  const [quizzing, setQuizzing] = useState(false);
  const [reveal, setReveal] = useState({});

  const run = useCallback(async (file) => {
    setError(""); setAtoms(null); setQuiz(null); setReveal({}); setFileName(file?.name || "");
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

  const quizMe = useCallback(async () => {
    if (!atoms?.length) return;
    setQuizzing(true); setError(""); setQuiz(null); setReveal({});
    try {
      const subject = fileName.replace(/\.[^.]+$/, "") || "this lecture";
      const r = await generateFromAtoms(
        { atoms, subject, difficulty: "medium", examples: readExemplars() },
        { callAIJSON }
      );
      if (r.error) setError(r.error);
      setQuiz(r.questions || []);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setQuizzing(false); }
  }, [atoms, fileName]);

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

        {atoms && atoms.length === 0 && !error && (
          <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3 text-xs text-text-2">
            No atoms returned. Either the lecture had no extractable signal, or the AI backend is unavailable
            (e.g. Firebase billing disabled / model unreachable). Check the console + function logs if this persists.
          </div>
        )}

        {atoms && atoms.length > 0 && (
          <div className="mb-4 flex items-center gap-3">
            <Button onClick={quizMe} disabled={quizzing}>{quizzing ? "Writing questions…" : "▸ Quiz me on these"}</Button>
            <span className="text-[10px] text-text-3">one Step-1 question per atom — this is what you learn</span>
          </div>
        )}

        {quiz && quiz.length > 0 && (
          <div className="mb-5 space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-accent-text">{quiz.length} questions from your atoms</div>
            {quiz.map((q, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg-elevated p-3">
                <div className="mb-2 text-sm text-text-1">{i + 1}. {q.stem}</div>
                <div className="flex flex-col gap-1">
                  {Object.entries(q.choices).map(([letter, txt]) => {
                    const shown = reveal[i]; const ok = letter === q.correct;
                    return <div key={letter} className={"text-xs " + (shown ? (ok ? "text-good font-semibold" : "text-text-3") : "text-text-2")}><span className="font-mono">{letter}.</span> {txt}{shown && ok ? "  ✓" : ""}</div>;
                  })}
                </div>
                {!reveal[i] ? (
                  <button onClick={() => setReveal((r) => ({ ...r, [i]: true }))} className="mt-2 text-[11px] text-accent-text hover:underline">Show answer</button>
                ) : (
                  q.explanation && <div className="mt-2 rounded border-l-2 border-accent bg-panel p-2 text-[11px] leading-relaxed text-text-2">{q.explanation}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {atoms && atoms.length > 0 && !error && (
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
