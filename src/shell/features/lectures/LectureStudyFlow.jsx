/**
 * SP1 T2.1 — one surface for studying a lecture.
 *
 * Replaces the two upload modals (🔬 Extract, ❓ Quiz): instead of dropping a
 * file and throwing the result away, this runs against a lecture that already
 * exists in the store, and the atoms it extracts persist on that lecture. The
 * upload path survives here as the fallback for chunk-light lectures — which is
 * most of them, since only the active term keeps chunks in localStorage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { selectBlockObjectives, setStatus, storageKeyFor, toEntry } from "../../logic/objectives.js";
import { computeTargetStatus } from "../../logic/graduationGate.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import * as performanceStore from "../../../stores/performance.js";
import * as atomTermIndex from "../../../stores/atomTermIndex.js";
import { normAtomKey, partitionAtomsForRound } from "../../../engine/atomNorm.js";
import { AtomQuiz } from "../../AtomQuiz.jsx";
import { FigureReview } from "./FigureReview.jsx";
import { bridgeComplete } from "../../../llmBridge.js";
import {
  applyStoredLabels,
  labelCandidates,
  readStoredLabels,
  selectCandidates,
} from "../../../lectureFigures.js";
import { readExemplars, resolveDefaultDifficulty } from "../objectives/quizLaunch.js";
import { generateStudyGuide } from "../../../engine/studyGuide.js";
import * as studyGuideStore from "../../../stores/studyGuide.js";
import * as masterGuideStore from "../../../stores/masterGuide.js";
import { ROUND_SIZE, atomRounds, extractAtoms, loadLecture, quizFromAtoms, roundDifficulty, roundLabel } from "./lectureStudy.js";
import {
  clearRoundProgress,
  readRoundProgress,
  resumeRound,
  saveRoundProgress,
} from "./lectureProgress.js";
import * as questionStats from "../../../stores/lectureQuestionStats.js";

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

export function LectureStudyFlow({ lecture, blockId, userId, logActivity, examDates, onClose, onGoDeep, onStartObjectiveQuiz }) {
  const [atoms, setAtoms] = useState([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState([]);
  const [figures, setFigures] = useState(null); // in-review, not yet uploaded
  const [stage, setStage] = useState("loading"); // loading | upload | extract | quiz
  const [questions, setQuestions] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  // Rounds already finished, read once on mount — this component is keyed by lecture id, so it
  // remounts (and re-reads) whenever you switch lectures.
  const [done, setDone] = useState(() => readRoundProgress(userId, lecture?.id));
  // Refreshed when a round ends rather than per answer: the panel is not on screen mid-round.
  const [qStats, setQStats] = useState(() => questionStats.statsForLecture(userId, lecture?.id));
  const [elapsed, setElapsed] = useState(0);
  const [skippedAtoms, setSkippedAtoms] = useState([]);
  // Track last round result to surface "Go Deep" prompt on completion
  const [lastResult, setLastResult] = useState(null);
  // Inline quiz config picker state
  const [quizPicker, setQuizPicker] = useState(null); // null | { count, difficulty }

  // Study guide — auto-generated searchable topic list, one per lecture mount
  const [studyGuide, setStudyGuide] = useState(null);
  const [generatingGuide, setGeneratingGuide] = useState(false);
  const guideGenRef = useRef(false);

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

  const generateGuide = useCallback(async (currentAtoms, currentObjectives) => {
    setGeneratingGuide(true);
    const result = await generateStudyGuide(
      { objectives: currentObjectives, atoms: currentAtoms, subject: title },
      { callAIJSON }
    );
    setGeneratingGuide(false);
    if (!result.topics?.length) return;
    const guide = {
      topics: result.topics.map((text, i) => ({ id: `t${i}`, text, checked: false })),
      generated: Date.now(),
    };
    studyGuideStore.write(userId, lecture?.id, guide);
    setStudyGuide(guide);
  }, [title, userId, lecture?.id]);

  // Auto-trigger: load cached guide or generate when atoms first populate
  useEffect(() => {
    if (!atoms.length || guideGenRef.current) return;
    guideGenRef.current = true;
    const stored = studyGuideStore.read(userId, lecture?.id);
    if (stored?.topics?.length) { setStudyGuide(stored); return; }
    generateGuide(atoms, lectureObjectives);
  }, [atoms]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Update cross-lecture atom index (non-blocking, non-critical)
    try { atomTermIndex.upsertLectureAtoms(userId, blockId, lecture?.id, r.atoms); } catch { /* ok */ }
  }, [lecture, userId, blockId]);

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

  // Annotate display atoms with cross-lecture recurrence from the term index
  const annotatedAtoms = useMemo(() => {
    const termIndex = atomTermIndex.read(userId, blockId) || {};
    return atoms.map((a) => {
      const entry = termIndex[normAtomKey(a.term)];
      const count = entry?.count ?? 1;
      return count >= 2 ? { ...a, isHighYield: true, crossCount: count } : a;
    });
  }, [atoms, userId, blockId]);

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
  /** The round Study should open on — one value, so the button's label and its action agree. */
  const nextRound = resumeRound(done, rounds.length);

  /** Questions for one round only — five atoms, with mastered-objective skip + HY sort. */
  const runRound = useCallback(async (index) => {
    const roundAtoms = rounds[index];
    if (!roundAtoms?.length) return;
    setBusy("Writing questions…"); setError(""); setQuestions(null);

    // Progressive difficulty, starting from what you've already earned on this
    // lecture rather than always at round-1-easy — same accuracy-based default
    // Quiz mode uses, so the two surfaces agree.
    const baseDifficulty = resolveDefaultDifficulty(questionStats.statsForLecture(userId, lecture?.id).accuracy);
    const difficulty = roundDifficulty(baseDifficulty, index);

    // Cross-lecture partition: skip atoms whose objectives are all mastered, flag recurring ones
    const termIndex = atomTermIndex.read(userId, blockId) || {};
    const { toQuiz, skipped } = partitionAtomsForRound(roundAtoms, termIndex, objectiveById);
    setSkippedAtoms(skipped);

    const quizAtoms = toQuiz.length ? toQuiz : roundAtoms; // fallback: quiz all if nothing left
    const r = await quizFromAtoms({ ...lecture, images }, quizAtoms, {
      callAIJSON, exemplars: readExemplars(userId), difficulty,
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
    // Stamp each question with _isHighYield from its source atom
    const hyKeys = new Set(quizAtoms.filter((a) => a.isHighYield).map((a) => normAtomKey(a.term)));
    const questions = (r.questions || []).map((q) =>
      q.topic && hyKeys.has(normAtomKey(q.topic)) ? { ...q, _isHighYield: true } : q
    );

    setRound(index);
    setQuestions(questions);
    logActivity?.({ lectureId: lecture?.id, activityType: "deep_learn", confidenceRating: null });
  }, [lecture, images, rounds, userId, blockId, objectiveById, logActivity]);


  /*
   * The app cannot see your disk, so it can never say "this lecture has 21 figures waiting".
   * What it knows is that it holds none, which is enough to offer once and then get out of the
   * way — figures are optional, and a lecture without them just asks text-only questions.
   *
   * Rendered in BOTH views deliberately. Study auto-starts into questions, so the atoms screen
   * is somewhere you may never look; between rounds is the moment you are actually free to go
   * fetch a folder.
   */
  const figuresPrompt = stage === "quiz" && atoms.length > 0 && !images.length && !figures && !busy && (
    <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-2.5 hover:border-border-strong">
      <span className="text-xs text-text-2">
        No figures for this lecture yet — add its histology and diagrams
        <span className="ml-1.5 text-text-3">
          (pick the lecture's folder from your marker output · once per lecture · ~2 min)
        </span>
      </span>
      <span className="font-mono text-[12px] text-text-3">browse</span>
      <input type="file" multiple webkitdirectory="" directory="" className="hidden" disabled={!!busy}
        onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; onFigures(f); }} />
    </label>
  );

  /*
   * Reviewing figures takes over the screen, before the questions branch gets a look in.
   *
   * The prompt that starts this is reachable from the quiz — which is the whole point, since
   * Study auto-starts there — so rendering the grid only on the atoms view meant clicking the
   * prompt appeared to do nothing at all. Picking figures is a task, not a side panel: it owns
   * the screen until you confirm or cancel, and the round is still there afterwards.
   */
  if (figures) {
    return (
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-mono text-xs text-text-3">{title} · figures</span>
          {busyLabel && <span className="font-mono text-[13px] text-text-3">{busyLabel}</span>}
        </div>
        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
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
      </div>
    );
  }

  if (questions) {
    const hasNext = round + 1 < rounds.length;
    return (
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button onClick={() => setQuestions(null)} className="font-mono text-xs text-text-3 hover:text-text-1">
            ← back to atoms
          </button>
          <span className="font-mono text-[13px] text-text-3">
            round {round + 1} of {rounds.length} · {roundLabel(round, rounds, atoms.length)} · {["easy","medium","hard","expert"][Math.min(round, 3)]}
          </span>
        </div>
        {(skippedAtoms.length > 0 || questions?.some((q) => q._isHighYield)) && (
          <div className="mb-3 flex flex-wrap gap-2 font-mono text-[12px]">
            {skippedAtoms.length > 0 && (
              <span className="rounded bg-good/10 px-2 py-0.5 text-good">
                ✓ {skippedAtoms.length} atom{skippedAtoms.length === 1 ? "" : "s"} skipped — objectives already mastered
              </span>
            )}
            {questions?.filter((q) => q._isHighYield).length > 0 && (
              <span className="rounded bg-accent/10 px-2 py-0.5 text-accent">
                ⭐ {questions.filter((q) => q._isHighYield).length} high-yield — recurring across lectures
              </span>
            )}
          </div>
        )}
        <AtomQuiz
          questions={questions}
          blockId={blockId}
          lectureId={lecture?.id ?? null}
          userId={userId}
          onExit={() => setQuestions(null)}
          onDone={({ correct = 0, total = 0, avgConfidence = 0, hasLandmines = false } = {}) => {
            const nextDone = Math.max(done, round + 1);
            saveRoundProgress(userId, lecture?.id, nextDone);
            setDone(nextDone);
            setQStats(questionStats.statsForLecture(userId, lecture?.id));
            const isLastRound = nextDone >= rounds.length;
            const score = total > 0 ? Math.round((correct / total) * 100) : 0;
            if (isLastRound) setLastResult({ score, hasLandmines });

            // Signal Today to auto-check once ≥60% of rounds are complete
            if (rounds.length > 0 && nextDone / rounds.length >= 0.6 && lecture?.id) {
              window.dispatchEvent(new CustomEvent("rxt-lecture-progress-60", {
                detail: { lectureId: lecture.id },
              }));
            }

            // Write session outcome to performance store after every completed round
            try {
              performanceStore.appendSession(userId, {
                lectureId: lecture?.id,
                blockId,
                score,
                avgConfidence,
                hasLandmines,
              });
            } catch { /* non-critical */ }

            // Only update objective status after the final round of a session
            if (!isLastRound) return;
            try {
              const perfStore = performanceStore.read(userId) || {};
              const perfKey = `${lecture?.id}__${blockId}`;
              const sessions = perfStore[perfKey]?.sessions || [];

              const blockExamDate = examDates?.[blockId] ?? null;
              const comprehensiveExamDate = examDates?.__comprehensive ?? null;

              const objStore = objectivesStore.read(userId) || {};
              let objs = selectBlockObjectives(objStore, blockId);
              let changed = false;

              for (const obj of lectureObjectives) {
                const target = computeTargetStatus({
                  sessions,
                  blockExamDate,
                  comprehensiveExamDate,
                  currentStatus: obj.status ?? "untested",
                });
                if (target && obj.status !== target) {
                  objs = setStatus(objs, obj.id, target, new Date());
                  changed = true;
                }
              }
              if (changed) {
                const storeKey = storageKeyFor(objStore, blockId);
                const nextEntry = toEntry(objStore[storeKey], objs);
                objectivesStore.write(userId, { ...objStore, [storeKey]: nextEntry });
              }
            } catch { /* non-critical */ }
          }}
        />
        <div className="mt-4 flex items-center gap-3">
          {hasNext ? (
            <>
              <Button onClick={() => runRound(round + 1)} disabled={!!busy}>
                {busyLabel || `▸ Next round (${Math.min(ROUND_SIZE, atoms.length - (round + 1) * ROUND_SIZE)} atoms)`}
              </Button>
              <button onClick={() => setQuestions(null)} className="font-mono text-[12px] text-text-3 hover:text-text-1">
                stop here
              </button>
            </>
          ) : (
            <div className="flex flex-col gap-3 w-full">
              <div className="rounded-lg border border-good/40 bg-good/5 px-4 py-3 text-sm font-semibold text-text-1">
                ✓ Lecture complete — all {rounds.length} round{rounds.length === 1 ? "" : "s"} done
              </div>
              {onGoDeep && lastResult && (lastResult.score < 70 || lastResult.hasLandmines) && (
                <div className="rounded-lg border border-warn/40 bg-warn/5 px-4 py-3">
                  <div className="mb-2 font-mono text-[13px] text-warn">
                    {lastResult.hasLandmines
                      ? "Confident wrong answers detected — deep study recommended"
                      : `Score ${lastResult.score}% — reinforce with clinical application`}
                  </div>
                  <Button onClick={() => onGoDeep(lecture?.id)}>
                    Go Deep on this lecture →
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={onClose}>← Back to Today</Button>
                <Button variant="outline" onClick={() => { setQuestions(null); }}>
                  Review atoms
                </Button>
              </div>
            </div>
          )}
        </div>
        {figuresPrompt}
      </div>
    );
  }

  // Objective status counts
  const objMastered = lectureObjectives.filter((o) => o.status === "mastered").length;
  const objDeveloping = lectureObjectives.filter((o) => o.status === "developing").length;
  const objUntested = lectureObjectives.length - objMastered - objDeveloping;
  const objPct = lectureObjectives.length > 0 ? Math.round((objMastered / lectureObjectives.length) * 100) : 0;
  // The bar shown here is effort you can SEE moving, not the mastery gate — a Quiz-button
  // attempt answers real questions on this lecture and deserves to fill it too, even though
  // it doesn't graduate an objective (that still needs a full Study pass or an 80%+ Quiz batch,
  // untouched below). `done` itself (round-resume bookkeeping) is not touched by this blend.
  const roundsFromQuestions = rounds.length > 0 ? Math.min(Math.floor(qStats.answered / ROUND_SIZE), rounds.length) : 0;
  const displayDone = Math.max(done, roundsFromQuestions);
  const roundPct = rounds.length > 0 ? Math.round((displayDone / rounds.length) * 100) : 0;
  const accuracyPct = qStats.accuracy == null ? 0 : Math.round(qStats.accuracy * 100);
  // Banded rather than a gradient: the only decision this drives is whether the lecture goes back
  // on the review pile, and 70% is where that answer changes.
  const accuracyColor = accuracyPct >= 85 ? "text-good" : accuracyPct >= 70 ? "text-accent" : "text-bad";
  // Same accuracy-based starting point runRound actually generates from — this used to always
  // read the round INDEX alone, so it could show "Easy" while the round it was about to hand you
  // was really Medium or Hard.
  const baseDifficulty = resolveDefaultDifficulty(qStats.accuracy);
  const currentDifficultyKey = roundDifficulty(baseDifficulty, round);
  const currentDifficulty = currentDifficultyKey[0].toUpperCase() + currentDifficultyKey.slice(1);
  const diffColor = {
    easy: "text-good", medium: "text-accent", hard: "text-warn", expert: "text-bad",
  }[currentDifficultyKey];

  return (
    <div className="p-5">
      <button onClick={onClose} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">
        ← back
      </button>
      <h2 className="text-lg font-bold text-text-1">{title}</h2>
      <div className="mb-4 font-mono text-[13px] text-text-3">
        {stage === "loading" ? "loading lecture…" : `${atoms.length} high-yield atoms`}
      </div>

      {/* Status panel — shown once atoms are loaded */}
      {stage === "quiz" && atoms.length > 0 && (
        <div className="mb-4 rounded-sm border border-border bg-bg-elevated divide-y divide-border/50">
          {/* Row 1: round progress + difficulty */}
          <div className="flex items-center gap-4 px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3 flex-shrink-0">Rounds</span>
              <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${roundPct}%`, background: roundPct === 100 ? "var(--color-good)" : "var(--color-accent)" }}
                />
              </div>
              <span className="font-mono text-[11px] text-text-2 flex-shrink-0">{displayDone}/{rounds.length}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3">Level</span>
              <span className={`font-mono text-[11px] font-bold ${diffColor}`}>{currentDifficulty}</span>
            </div>
          </div>

          {/* Row 1b: questions answered — how much work this lecture has actually had. Accuracy is
              shown next to it because the count alone cannot tell drilled-and-solid from
              drilled-and-still-missing, which is the thing that decides what to review. */}
          {qStats.answered > 0 && (
            <div className="flex items-center gap-4 px-4 py-2.5">
              <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3 flex-shrink-0">Questions</span>
              <span className="font-mono text-[11px] text-text-2 flex-1 min-w-0">
                {qStats.answered} answered
                <span className="text-text-3"> · {qStats.correct} correct</span>
              </span>
              <span className={`font-mono text-[11px] font-bold flex-shrink-0 ${accuracyColor}`}>{accuracyPct}%</span>
            </div>
          )}

          {/* Row 2: objectives breakdown */}
          {lectureObjectives.length > 0 && (
            <div className="flex items-center gap-4 px-4 py-2.5">
              <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3 flex-shrink-0">Objectives</span>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {objMastered > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-good">
                    <span className="h-2 w-2 rounded-full bg-good flex-shrink-0" />
                    {objMastered} mastered
                  </span>
                )}
                {objDeveloping > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-accent">
                    <span className="h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                    {objDeveloping} developing
                  </span>
                )}
                {objUntested > 0 && (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-text-3">
                    <span className="h-2 w-2 rounded-full bg-border flex-shrink-0" />
                    {objUntested} untested
                  </span>
                )}
              </div>
              <span className="font-mono text-[11px] text-text-2 flex-shrink-0">{objPct}%</span>
            </div>
          )}
        </div>
      )}
      {stage === "quiz" && atoms.length > 0 && (
        <div className="mb-4 -mt-2 font-mono text-[11px] text-text-3">
          Rounds fills from any question answered here, Study or Quiz. Objectives still graduate
          to mastered only on finishing all rounds, or a Quiz scoring 80%+ — that bar stays strict
          on purpose, it's what your schedule leans on.
        </div>
      )}

      {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}

      {stage === "upload" && (
        <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">
            No stored text for this lecture — choose its .md {busy ? "" : "(from pdf2md)"}
          </span>
          <span className="font-mono text-[12px] text-text-3">{busy || "browse"}</span>
          <input type="file" accept=".md,.markdown,.txt" className="hidden" disabled={!!busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }} />
        </label>
      )}

      {stage === "extract" && (
        <div className="mb-4 flex items-center gap-3">
          <Button onClick={() => runExtract(text)} disabled={!!busy}>
            {busyLabel || "▸ Extract the signal"}
          </Button>
          <span className="text-[12px] text-text-3">definitions, mechanisms, relationships, results — fluff dropped</span>
        </div>
      )}

      {stage === "quiz" && atoms.length > 0 && (
        <div className="mb-4 flex flex-col gap-3">
          {/* Unified generate button — opens inline picker */}
          {!quizPicker ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => setQuizPicker({ count: 10, difficulty: "medium" })} disabled={!!busy}>
                {busyLabel || "▸ Generate questions"}
              </Button>
              <span className="text-[12px] text-text-3">
                {atoms.length} atoms · {lectureObjectives.length} objectives
                {done > 0 ? ` · ${done}/${rounds.length} rounds done` : ""}
                {qStats.answered > 0 ? ` · ${qStats.answered} questions answered` : ""}
              </span>
              {done > 0 && (
                <button
                  onClick={() => { clearRoundProgress(userId, lecture?.id); setDone(0); setRound(0); }}
                  /* Question counts deliberately survive "start over" — they are a record of work
                     done, not a bookmark, and resetting them would erase the lecture's history. */
                  disabled={!!busy}
                  className="font-mono text-[12px] text-text-3 underline decoration-dotted hover:text-text-1"
                >
                  reset progress
                </button>
              )}
            </div>
          ) : (
            /* Inline count + difficulty picker */
            <div className="rounded-sm border border-border bg-bg-elevated p-4 flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <span className="font-condensed text-[12px] font-semibold uppercase tracking-wide text-text-3 w-20">Questions</span>
                <div className="flex gap-1.5">
                  {[5, 10, 25, 50, 100].map((n) => (
                    <button
                      key={n}
                      onClick={() => setQuizPicker((p) => ({ ...p, count: n }))}
                      className={[
                        "rounded-sm border px-2.5 py-1 font-mono text-[12px] transition-colors",
                        quizPicker.count === n
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-text-2 hover:border-border-strong",
                      ].join(" ")}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-condensed text-[12px] font-semibold uppercase tracking-wide text-text-3 w-20">Difficulty</span>
                <div className="flex gap-1.5">
                  {["easy", "medium", "hard", "expert"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setQuizPicker((p) => ({ ...p, difficulty: d }))}
                      className={[
                        "rounded-sm border px-2.5 py-1 font-condensed text-[12px] uppercase tracking-wide transition-colors",
                        quizPicker.difficulty === d
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-text-2 hover:border-border-strong",
                      ].join(" ")}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  onClick={() => {
                    const { count, difficulty } = quizPicker;
                    setQuizPicker(null);
                    onStartObjectiveQuiz(lectureObjectives, title, blockId, {
                      lectureId: lecture?.id,
                      atoms,
                      difficulty,
                      count,
                    });
                  }}
                  disabled={!!busy}
                >
                  Generate {quizPicker.count} questions
                </Button>
                <button onClick={() => setQuizPicker(null)} className="font-mono text-[12px] text-text-3 hover:text-text-1">
                  cancel
                </button>
                <span className="font-mono text-[12px] text-text-3">
                  school style{lectureObjectives.length > 0 ? " + objectives" : ""} + USMLE · grounded in {atoms.length} key facts
                </span>
              </div>
            </div>
          )}

          {/* Tagging */}
          {lectureObjectives.length > 0 && untagged > 0 && (
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={runTagging} disabled={!!busy}>
                ◇ Tag atoms to objectives
              </Button>
              <span className="text-[12px] text-text-3">
                {untagged} of {atoms.length} untagged · {lectureObjectives.length} objectives
              </span>
            </div>
          )}
          {images.length > 0 && (
            <span className="text-[12px] text-text-3">{images.length} figures attached</span>
          )}
        </div>
      )}

      {figuresPrompt}

      {/* The atom list is reference, not the session. Reading it is the passive habit this
          screen used to force; it stays one click away for when you actually want it. */}
      {/* Study guide — auto-generated searchable topics, checkable */}
      {(studyGuide || generatingGuide) && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-center gap-3">
            <span className="font-condensed text-[11px] font-semibold uppercase tracking-wide text-text-3">
              Study guide
              {studyGuide && !generatingGuide && (
                <span className="ml-1.5 text-text-3 font-normal normal-case font-mono">
                  · {studyGuide.topics.filter((t) => !t.checked).length} remaining
                </span>
              )}
            </span>
            {!generatingGuide && studyGuide && (
              <button
                onClick={() => { guideGenRef.current = false; generateGuide(atoms, lectureObjectives); }}
                className="font-mono text-[11px] text-text-3 underline decoration-dotted hover:text-text-1"
              >
                regenerate
              </button>
            )}
          </div>
          {generatingGuide && (
            <span className="font-mono text-[12px] text-text-3">building study guide…</span>
          )}
          {studyGuide && (
            <div className="flex flex-col gap-1.5">
              {studyGuide.topics.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-start gap-2.5 group">
                  <input
                    type="checkbox"
                    checked={t.checked || false}
                    className="mt-0.5 accent-accent shrink-0"
                    onChange={(e) => {
                      const next = studyGuideStore.setTopicChecked(userId, lecture?.id, t.id, e.target.checked);
                      setStudyGuide(next);
                      masterGuideStore.syncFromLectureTopic(userId, blockId, lecture?.id, t.id, e.target.checked);
                    }}
                  />
                  <span className={[
                    "text-sm leading-snug",
                    t.checked ? "text-text-3 line-through" : "text-text-1",
                  ].join(" ")}>
                    {t.text}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {atoms.length > 0 && (
        <details className="group mt-4">
          <summary className="cursor-pointer list-none font-mono text-[13px] text-text-3 hover:text-text-1">
            ▸ review all {atoms.length} atoms
          </summary>
          <div className="mt-3 space-y-4">
          {HY_TYPES.map((type) => {
            const list = annotatedAtoms.filter((a) => a.type === type);
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
                      {a.isHighYield && (
                        <span className="ml-1.5 rounded bg-accent/15 px-1 font-mono text-[13px] text-accent" title={`Appears in ${a.crossCount} lectures`}>
                          ⭐ ×{a.crossCount}
                        </span>
                      )}
                      <span className="text-text-2"> — {a.content}</span>
                      {a.objectiveIds?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {objectiveChips(a.objectiveIds, objectiveById).map((chip) => (
                            <span
                              key={chip.key}
                              title={chip.title}
                              className="rounded border border-border px-1.5 py-0.5 font-mono text-[13px] text-text-3"
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
