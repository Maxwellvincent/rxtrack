/**
 * SP1 T2.1 — one surface for studying a lecture.
 *
 * Replaces the two upload modals (🔬 Extract, ❓ Quiz): instead of dropping a
 * file and throwing the result away, this runs against a lecture that already
 * exists in the store, and the atoms it extracts persist on that lecture. The
 * upload path survives here as the fallback for chunk-light lectures — which is
 * most of them, since only the active term keeps chunks in localStorage.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { callAIJSON } from "../../../aiClient.js";
import {
  fetchLectureContent,
  saveLectureAtoms,
  saveLectureImages,
  uploadLectureImages,
} from "../../../supabase.js";
import { HY_TYPES } from "../../../engine/highYield.js";
import { tagAtomsWithObjectives } from "../../../engine/tagAtoms.js";
import { selectBlockObjectives } from "../../logic/objectives.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { AtomQuiz } from "../../AtomQuiz.jsx";
import { FigureReview } from "./FigureReview.jsx";
import { bridgeComplete } from "../../../llmBridge.js";
import {
  applyStoredLabels,
  labelCandidates,
  readStoredLabels,
  selectCandidates,
} from "../../../lectureFigures.js";
import { readExemplars } from "../objectives/quizLaunch.js";
import { ROUND_SIZE, atomRounds, extractAtoms, loadLecture, quizFromAtoms, roundLabel } from "./lectureStudy.js";

const TYPE_META = {
  definition: { label: "Definitions", hint: "what it is", accent: "border-l-accent" },
  mechanism: { label: "Mechanisms", hint: "how it works", accent: "border-l-good" },
  relationship: { label: "Relationships", hint: "how things relate", accent: "border-l-accent" },
  result: { label: "Results", hint: "the outcome", accent: "border-l-bad" },
};

/**
 * One chip per objective an atom serves. Objectives without a SOM code fall
 * back to their text, and chips are deduped by label because this data has
 * duplicate objective rows sharing a code — four identical chips on one atom
 * says nothing useful.
 */
function objectiveChips(objectiveIds, objectiveById) {
  const seen = new Map();
  for (const id of objectiveIds) {
    const objective = objectiveById.get(id);
    const text = objective ? objective.objective || objective.text || "" : "";
    const label = objective?.code || (text ? `${text.slice(0, 26)}${text.length > 26 ? "…" : ""}` : "objective");
    if (!seen.has(label)) seen.set(label, { key: id, label, title: text || id });
  }
  return [...seen.values()];
}

export function LectureStudyFlow({ lecture, blockId, userId, onClose }) {
  const [atoms, setAtoms] = useState([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [figures, setFigures] = useState(null); // in-review, not yet uploaded
  const [stage, setStage] = useState("loading"); // loading | upload | extract | quiz
  const [questions, setQuestions] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  const [started, setStarted] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Writing five questions on the local bridge takes ~40s. Without a moving number that reads
  // as a hung app, and the honest fix is to show the wait, not to hide it.
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);
  const busyLabel = busy ? `${busy}${elapsed ? ` ${elapsed}s` : ""}` : "";

  const title = lecture?.lectureTitle || lecture?.title || lecture?.fileName || "Lecture";

  // Shell keys this component by lecture id, so switching lectures remounts it
  // with fresh state instead of needing a synchronous reset in here.
  useEffect(() => {
    let alive = true;
    loadLecture(lecture, { fetchContent: fetchLectureContent, userId }).then((r) => {
      if (!alive) return;
      setAtoms(r.atoms); setText(r.text); setImages(r.images || []); setStage(r.stage);
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

  // This lecture's objectives, by id — the tagging target and the chip labels.
  const lectureObjectives = useMemo(() => {
    const all = selectBlockObjectives(objectivesStore.read(userId), blockId);
    return all.filter((o) => o?.linkedLecId === lecture?.id);
  }, [blockId, userId, lecture?.id]);

  const objectiveById = useMemo(
    () => new Map(lectureObjectives.map((o) => [o.id, o])),
    [lectureObjectives]
  );

  const untagged = atoms.filter((a) => !a.objectiveIds?.length).length;

  /**
   * Tag atoms to the objectives they serve. This is the join SP2's learner
   * model reads: a missed question on an atom becomes evidence against the
   * objective the curriculum is written in.
   */
  const runTagging = useCallback(async () => {
    setBusy("Matching atoms to objectives…"); setError("");
    const r = await tagAtomsWithObjectives(atoms, lectureObjectives, { callAIJSON });
    setBusy("");
    if (r.error && !r.tagged) { setError(r.error); return; }
    if (r.error) setError(`Partly tagged (${r.byTerm} by name): ${r.error}`);
    setAtoms(r.atoms);
    try {
      await saveLectureAtoms(userId, lecture?.id, r.atoms);
    } catch (e) {
      setError(`Tagged, but saving failed: ${e?.message || String(e)}`);
    }
  }, [atoms, lectureObjectives, lecture, userId]);

  /**
   * Pick the lecture's folder and get cards back: harvest the figures its markdown references,
   * label them against the local bridge, and show them for review. Nothing is uploaded here —
   * that waits for `confirmFigures`, so a figure you reject never leaves the machine.
   *
   * The lecture's own markdown is what says which images belong to it and what text surrounds
   * them, so a folder without it cannot be placed.
   */
  const onFigures = useCallback(async (files) => {
    setError("");
    const mdFile = files.find((f) => /\.(md|markdown)$/i.test(f.name));
    const markdown = mdFile ? await mdFile.text() : text;
    if (!markdown) {
      setError("Include the lecture's .md in the selection — it says which figures belong where.");
      return;
    }

    setBusy("Reading the folder…");
    const candidates = await selectCandidates({ files, markdown });
    if (!candidates.length) {
      setBusy("");
      setError("No figures in that folder — either it has none, or they are all too small to be content.");
      return;
    }

    // Shown as soon as they exist: labelling adds captions, it is not what makes them reviewable.
    setFigures(candidates.map((c) => ({ ...c, kind: "unlabelled", shows: "", keep: true })));

    // A folder pre-labelled by scripts/label-lecture-images.mjs skips straight to review —
    // relabelling it would spend minutes to arrive at the same captions.
    const stored = await readStoredLabels(files);
    if (stored) {
      setFigures(applyStoredLabels(candidates, stored));
      setBusy("");
      return;
    }

    setBusy(`Labelling ${candidates.length} figures…`);
    const labelled = await labelCandidates(candidates, {
      complete: bridgeComplete,
      onProgress: (n, total) => setBusy(`Labelling figures… ${n}/${total}`),
    });
    setFigures(labelled);
    setBusy("");
  }, [text]);

  /** Upload only what survived review, then remember it on the lecture. */
  const confirmFigures = useCallback(async () => {
    const kept = figures.filter((f) => f.keep && f.kind !== "decorative");
    if (!kept.length) return;
    setBusy("Uploading figures…");
    const byName = new Map(kept.map((f) => [f.name, f.file]));
    // A figure kept without a label still has to have a kind, or nothing will ever render it.
    // "diagram" is the neutral choice: it claims the least about what the picture is.
    const manifest = kept.map((f) => ({
      file: f.name,
      kind: f.kind === "unlabelled" ? "diagram" : f.kind,
      shows: f.shows,
      context: f.context,
    }));
    const stored = await uploadLectureImages(userId, lecture?.id, manifest, byName, (n, total) =>
      setBusy(`Uploading figures… ${n}/${total}`)
    );
    setBusy("");
    if (!stored.length) {
      setError("Upload failed — the figures are still selected, try again.");
      return;
    }
    setImages(stored);
    setFigures(null);
    try {
      await saveLectureImages(userId, lecture?.id, stored);
    } catch (e) {
      setError(`Figures loaded for this session but not saved: ${e?.message || e}`);
    }
  }, [figures, lecture, userId]);

  const rounds = useMemo(() => atomRounds(atoms), [atoms]);

  /** Questions for one round only — five atoms, not the whole lecture. */
  const runRound = useCallback(async (index) => {
    const roundAtoms = rounds[index];
    if (!roundAtoms?.length) return;
    setBusy("Writing questions…"); setError(""); setQuestions(null);
    const r = await quizFromAtoms({ ...lecture, images }, roundAtoms, {
      callAIJSON, exemplars: readExemplars(userId),
    });
    setBusy("");
    if (r.error) { setError(r.error); return; }
    if (!r.questions?.length) {
      setError(
        "No questions came back. The local bridge was unreachable and the cloud provider returned " +
        "nothing — check that llm-bridge is running, or the console for the bridge reason."
      );
      return;
    }
    setRound(index);
    setQuestions(r.questions);
  }, [lecture, images, rounds, userId]);

  // You clicked Study, so studying is what should happen — land on question 1 rather than on a
  // wall of atoms to read. Fires once per lecture; `started` keeps a re-render from re-asking.
  useEffect(() => {
    if (stage !== "quiz" || started || busy || questions || !rounds.length) return;
    setStarted(true);
    runRound(0);
  }, [stage, started, busy, questions, rounds, runRound]);

  if (questions) {
    const hasNext = round + 1 < rounds.length;
    return (
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button onClick={() => setQuestions(null)} className="font-mono text-xs text-text-3 hover:text-text-1">
            ← back to atoms
          </button>
          <span className="font-mono text-[11px] text-text-3">
            round {round + 1} of {rounds.length} · {roundLabel(round, rounds, atoms.length)}
          </span>
        </div>
        <AtomQuiz questions={questions} blockId={blockId} />
        <div className="mt-4 flex items-center gap-3">
          {hasNext ? (
            <>
              <Button onClick={() => runRound(round + 1)} disabled={!!busy}>
                {busyLabel || `▸ Next ${Math.min(ROUND_SIZE, atoms.length - (round + 1) * ROUND_SIZE)}`}
              </Button>
              <span className="text-[10px] text-text-3">or stop here — the round is done</span>
            </>
          ) : (
            <span className="text-[10px] text-text-3">that was the last round of this lecture</span>
          )}
        </div>
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
            {busyLabel || "▸ Extract the signal"}
          </Button>
          <span className="text-[10px] text-text-3">definitions, mechanisms, relationships, results — fluff dropped</span>
        </div>
      )}

      {stage === "quiz" && atoms.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => runRound(round)} disabled={!!busy}>
            {busyLabel || `▸ Study ${Math.min(ROUND_SIZE, atoms.length)}`}
          </Button>
          <span className="text-[10px] text-text-3">
            {rounds.length} rounds of {ROUND_SIZE} · one calibrated Step-1 question per atom
          </span>
          {lectureObjectives.length > 0 && untagged > 0 && (
            <>
              <Button variant="outline" onClick={runTagging} disabled={!!busy}>
                ◇ Tag to objectives
              </Button>
              <span className="text-[10px] text-text-3">
                {untagged} of {atoms.length} untagged · {lectureObjectives.length} objectives on this lecture
              </span>
            </>
          )}
          {lectureObjectives.length > 0 && untagged === 0 && (
            <span className="text-[10px] text-text-3">
              all {atoms.length} atoms tagged to objectives
            </span>
          )}
          {lectureObjectives.length === 0 && (
            <span className="text-[10px] text-text-3">no objectives linked to this lecture — nothing to tag against</span>
          )}
          {images.length > 0 ? (
            <span className="text-[10px] text-text-3">{images.length} figures — shown with the atoms they belong to</span>
          ) : !figures && (
            /* Whole folder: the .md says which figures belong to this lecture and what text
               surrounds them, so the images alone are not enough to place anything. */
            <label className="cursor-pointer font-mono text-[10px] text-text-3 underline decoration-dotted hover:text-text-1">
              + add this lecture's figures
              <input type="file" multiple webkitdirectory="" directory="" className="hidden" disabled={!!busy}
                onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; onFigures(f); }} />
            </label>
          )}
        </div>
      )}

      {figures && (
        <FigureReview
          figures={figures}
          busy={busy}
          onToggle={(i) => setFigures((prev) => prev.map((f, j) => (j === i ? { ...f, keep: !f.keep } : f)))}
          onKind={(i, kind) =>
            setFigures((prev) =>
              prev.map((f, j) => (j === i ? { ...f, kind, keep: kind !== "decorative" } : f))
            )
          }
          onConfirm={confirmFigures}
          onCancel={() => setFigures(null)}
        />
      )}

      {/* The atom list is reference, not the session. Reading it is the passive habit this
          screen used to force; it stays one click away for when you actually want it. */}
      {atoms.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none font-mono text-[11px] text-text-3 hover:text-text-1">
            ▸ review all {atoms.length} atoms
          </summary>
          <div className="mt-3 space-y-4">
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
                      {a.objectiveIds?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {objectiveChips(a.objectiveIds, objectiveById).map((chip) => (
                            <span
                              key={chip.key}
                              title={chip.title}
                              className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-text-3"
                            >
                              {chip.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          </div>
        </details>
      )}
    </div>
  );
}

export default LectureStudyFlow;
