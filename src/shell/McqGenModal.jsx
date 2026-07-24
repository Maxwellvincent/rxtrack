import { useState, useCallback } from "react";
import { Button } from "../ui/Button.jsx";
import { callAIJSON } from "../aiClient.js";
import { generateMcqs } from "../engine/mcq.js";

// Pull any exam-bank questions the student already uploaded (rxt-question-banks)
// to use as few-shot STYLE exemplars.
function readExemplars() {
  try {
    const banks = JSON.parse(localStorage.getItem("rxt-question-banks") || "{}");
    return Object.values(banks).flat().filter((q) => q && q.stem && q.choices).slice(0, 5);
  } catch { return []; }
}

const DIFFS = ["easy", "medium", "hard", "expert"];

export function McqGenModal({ onClose }) {
  const [fileName, setFileName] = useState("");
  const [lectureText, setLectureText] = useState("");
  const [difficulty, setDifficulty] = useState("medium");
  const [count, setCount] = useState(5);
  const [questions, setQuestions] = useState(null);
  const [reveal, setReveal] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const exemplars = readExemplars();

  const onFile = useCallback(async (file) => {
    setError(""); setQuestions(null); setFileName(file?.name || "");
    if (!file) return;
    setLectureText(await file.text());
  }, []);

  const generate = useCallback(async () => {
    if (!lectureText) { setError("Upload a lecture .md first."); return; }
    setBusy(true); setError(""); setQuestions(null); setReveal({});
    try {
      const subject = fileName.replace(/\.[^.]+$/, "") || "this lecture";
      const r = await generateMcqs(
        { lectureText, subject, difficulty, count: Number(count), examples: exemplars },
        { callAIJSON }
      );
      if (r.error) setError(r.error);
      setQuestions(r.questions || []);
    } catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }, [lectureText, fileName, difficulty, count, exemplars]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Generate Step 1 questions</div>
        <div className="mb-4 text-xs text-text-3">
          Upload a lecture <b>.md</b>. Questions are modeled on your uploaded exam-bank style
          ({exemplars.length} exemplar{exemplars.length === 1 ? "" : "s"} found) and grounded in the lecture.
        </div>

        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{fileName || "Choose lecture .md / .txt"}</span>
          <span className="font-mono text-[10px] text-text-3">browse</span>
          <input type="file" accept=".md,.markdown,.txt" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
        </label>

        <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-text-2">Difficulty
            <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}
              className="rounded-md border border-border bg-bg-elevated px-2 py-1 text-text-1">
              {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-text-2">Count
            <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)}
              className="w-16 rounded-md border border-border bg-bg-elevated px-2 py-1 text-text-1" />
          </label>
          <Button onClick={generate} disabled={busy || !lectureText}>{busy ? "Generating…" : "Generate"}</Button>
        </div>

        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
        {questions && questions.length === 0 && !error && (
          <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3 text-xs text-text-2">
            No questions returned — the AI backend may be unavailable (e.g. Firebase billing disabled). Check console/function logs.
          </div>
        )}

        {questions && questions.length > 0 && (
          <div className="space-y-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-text-3">{questions.length} questions</div>
            {questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg-elevated p-3">
                <div className="mb-2 text-sm text-text-1">{i + 1}. {q.stem}</div>
                <div className="flex flex-col gap-1">
                  {Object.entries(q.choices).map(([letter, txt]) => {
                    const shown = reveal[i];
                    const isCorrect = letter === q.correct;
                    const cls = shown ? (isCorrect ? "text-good font-semibold" : "text-text-3") : "text-text-2";
                    return <div key={letter} className={"text-xs " + cls}><span className="font-mono">{letter}.</span> {txt}{shown && isCorrect ? "  ✓" : ""}</div>;
                  })}
                </div>
                {!reveal[i] ? (
                  <button onClick={() => setReveal((r) => ({ ...r, [i]: true }))}
                    className="mt-2 text-[11px] text-accent-text hover:underline">Show answer</button>
                ) : (
                  q.explanation && <div className="mt-2 rounded border-l-2 border-accent bg-panel p-2 text-[11px] leading-relaxed text-text-2">{q.explanation}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    </div>
  );
}
