/**
 * SP1 T2.1 — one surface for studying a lecture.
 *
 * Replaces the two upload modals (🔬 Extract, ❓ Quiz): instead of dropping a
 * file and throwing the result away, this runs against a lecture that already
 * exists in the store, and the atoms it extracts persist on that lecture. The
 * upload path survives here as the fallback for chunk-light lectures — which is
 * most of them, since only the active term keeps chunks in localStorage.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { callAIJSON } from "../../../aiClient.js";
import { fetchLectureContent, saveLectureAtoms } from "../../../supabase.js";
import { HY_TYPES } from "../../../engine/highYield.js";
import { AtomQuiz } from "../../AtomQuiz.jsx";
import { readExemplars } from "../objectives/quizLaunch.js";
import { extractAtoms, loadLecture, quizFromAtoms } from "./lectureStudy.js";

const TYPE_META = {
  definition: { label: "Definitions", hint: "what it is", accent: "border-l-accent" },
  mechanism: { label: "Mechanisms", hint: "how it works", accent: "border-l-good" },
  relationship: { label: "Relationships", hint: "how things relate", accent: "border-l-accent" },
  result: { label: "Results", hint: "the outcome", accent: "border-l-bad" },
};

export function LectureStudyFlow({ lecture, blockId, userId, onClose }) {
  const [atoms, setAtoms] = useState([]);
  const [text, setText] = useState("");
  const [stage, setStage] = useState("loading"); // loading | upload | extract | quiz
  const [questions, setQuestions] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const title = lecture?.lectureTitle || lecture?.title || lecture?.fileName || "Lecture";

  // Shell keys this component by lecture id, so switching lectures remounts it
  // with fresh state instead of needing a synchronous reset in here.
  useEffect(() => {
    let alive = true;
    loadLecture(lecture, { fetchContent: fetchLectureContent, userId }).then((r) => {
      if (!alive) return;
      setAtoms(r.atoms); setText(r.text); setStage(r.stage);
      if (r.error) setError(r.error);
    });
    return () => { alive = false; };
  }, [lecture, userId]);

  const runExtract = useCallback(async (sourceText) => {
    setBusy("Reading the lecture…"); setError("");
    const r = await extractAtoms(lecture, sourceText, {
      callAIJSON, saveAtoms: saveLectureAtoms, userId,
    });
    setBusy("");
    if (r.error) { setError(r.error); return; }
    // A save failure is worth saying out loud — the atoms work this session but
    // will need re-extracting next time.
    if (r.saveError) setError(`Atoms ready, but saving them failed: ${r.saveError}`);
    setAtoms(r.atoms);
    setStage("quiz");
  }, [lecture, userId]);

  const onFile = useCallback(async (file) => {
    if (!file) return;
    const uploaded = await file.text();
    setText(uploaded);
    if (uploaded.trim().length < 200) { setError("That file has almost no text in it."); return; }
    await runExtract(uploaded);
  }, [runExtract]);

  const runQuiz = useCallback(async () => {
    setBusy("Writing questions…"); setError(""); setQuestions(null);
    const r = await quizFromAtoms(lecture, atoms, { callAIJSON, exemplars: readExemplars() });
    setBusy("");
    if (r.error) { setError(r.error); return; }
    if (!r.questions?.length) { setError("No questions came back."); return; }
    setQuestions(r.questions);
  }, [lecture, atoms]);

  if (questions) {
    return (
      <div className="p-5">
        <button onClick={() => setQuestions(null)} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">
          ← back to atoms
        </button>
        <AtomQuiz questions={questions} blockId={blockId} />
      </div>
    );
  }

  return (
    <div className="p-5">
      <button onClick={onClose} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">
        ← back to objectives
      </button>
      <h2 className="text-lg font-bold text-text-1">{title}</h2>
      <div className="mb-4 font-mono text-[11px] text-text-3">
        {stage === "loading" ? "loading lecture…" : `${atoms.length} high-yield atoms`}
      </div>

      {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}

      {stage === "upload" && (
        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">
            No stored text for this lecture — choose its .md {busy ? "" : "(from pdf2md)"}
          </span>
          <span className="font-mono text-[10px] text-text-3">{busy || "browse"}</span>
          <input type="file" accept=".md,.markdown,.txt" className="hidden" disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
        </label>
      )}

      {stage === "extract" && (
        <div className="mb-4 flex items-center gap-3">
          <Button onClick={() => runExtract(text)} disabled={!!busy}>
            {busy || "▸ Extract the signal"}
          </Button>
          <span className="text-[10px] text-text-3">definitions, mechanisms, relationships, results — fluff dropped</span>
        </div>
      )}

      {stage === "quiz" && atoms.length > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <Button onClick={runQuiz} disabled={!!busy}>{busy || "▸ Quiz me on these"}</Button>
          <span className="text-[10px] text-text-3">one calibrated Step-1 question per atom</span>
        </div>
      )}

      {atoms.length > 0 && (
        <div className="space-y-4">
          {HY_TYPES.map((type) => {
            const list = atoms.filter((a) => a.type === type);
            if (!list.length) return null;
            const meta = TYPE_META[type];
            return (
              <div key={type}>
                <div className="mb-1.5 text-sm font-semibold text-text-1">
                  {meta.label} <span className="font-normal text-text-3">· {meta.hint} · {list.length}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {list.map((a, i) => (
                    <div key={i} className={"rounded-lg border-l-2 bg-bg-elevated px-3 py-2 text-xs " + meta.accent}>
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
    </div>
  );
}

export default LectureStudyFlow;
