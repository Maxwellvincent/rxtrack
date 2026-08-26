/**
 * SP1 T6.1 — adding a lecture from the shell.
 *
 * Markdown (pdf2md locally, drop the .md here) or the PDF itself, which runs
 * through the same extraction chain App uses — marker/datalab/mistral OCR,
 * falling back to pdfplumber. Objectives and the teaching map run as explicit
 * steps after the save, each costing one model call.
 *
 * Uploading a lecture that already exists FILLS it rather than replacing it.
 * A block's lectures come from the schedule import first — right numbers, right
 * dates, no content — and the deck is the content they were waiting for. A
 * replace would mint a new id and drop the date Today plans from.
 */
import { useCallback, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import * as lecturesStore from "../../../stores/lectures.js";
import {
  overwriteObjectivesInCloud,
  saveLectureAtoms,
  saveLectureToCloud,
} from "../../../supabase.js";
import { stripTeachingMap } from "../../../lectureTeachingMap.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { assessTextQuality, extractWithSmartFallback } from "../../../ingest/pdfText.js";
import { extractObjectivesFromLecture } from "../../../ingest/objectives.js";
import { analyzeLecture } from "../../../ingest/teachingMap.js";
import { createObjectiveCommands } from "../../logic/objectives.js";
import { extractAtoms as extractAtomsForLecture, MIN_TEXT } from "./lectureStudy.js";
import { callAIJSON } from "../../../aiClient.js";
import { generateStudyGuide } from "../../../engine/studyGuide.js";
import { generateMentalModel } from "../../../engine/mentalModel.js";
import * as studyGuideStore from "../../../stores/studyGuide.js";
import * as mentalModelStore from "../../../stores/mentalModel.js";
import {
  buildLectureRecord,
  buildLectureFromExtraction,
  parseLectureFilename,
  upsertLecture,
} from "../../logic/lectureIngest.js";
import { toLocalRow } from "../../logic/bulkIngest.js";

/** Commands over the objectives store, built per call so no stale store is captured. */
function makeObjectiveCommands(userId) {
  return createObjectiveCommands({
    read: () => objectivesStore.read(userId) || {},
    write: (next) => objectivesStore.write(userId, next),
    notify: () => { try { window.dispatchEvent(new CustomEvent("rxt-objectives-updated")); } catch { /* non-DOM */ } },
  });
}

/** Text the objective extractor reads: whatever the record actually carries. */
function lectureText(lecture) {
  if (lecture?.fullText) return lecture.fullText;
  return (lecture?.chunks || []).map((c) => c.markdown || c.text || "").join("\n\n");
}

export function AddLectureModal({ blockId, termId = null, userId = null, onClose, onAdded }) {
  const [preview, setPreview] = useState(null); // { lecture, action, replacedId }
  const [lectureDate, setLectureDate] = useState("");
  const [useLlm, setUseLlm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [progress, setProgress] = useState("");
  const [saved, setSaved] = useState(null);            // the lecture just written
  const [objectiveResult, setObjectiveResult] = useState("");
  const [mapResult, setMapResult] = useState("");
  const [atomsResult, setAtomsResult] = useState("");
  const [assetsResult, setAssetsResult] = useState("");

  const onFile = useCallback(
    async (file) => {
      setError(""); setDone(""); setPreview(null); setProgress("");
      setSaved(null); setObjectiveResult(""); setMapResult("");
      if (!file) return;

      const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
      let built;
      let quality = null;

      if (isPdf) {
        setBusy(true);
        try {
          const { contentResult, method } = await extractWithSmartFallback(
            file,
            (msg) => setProgress(msg),
            { detectNumber: (name) => parseLectureFilename(name).number, userId, useLlm }
          );
          quality = assessTextQuality(contentResult?.fullText || "");
          built = buildLectureFromExtraction({ filename: file.name, contentResult, method, blockId, termId });
        } catch (e) {
          setError("Could not read that PDF: " + (e?.message || String(e)));
          return;
        } finally {
          setBusy(false);
          setProgress("");
        }
      } else {
        const text = await file.text();
        built = buildLectureRecord({ filename: file.name, text, blockId, termId });
      }

      if (built.error) { setError(built.error); return; }

      const current = lecturesStore.read(userId) || [];
      const { action, filledId, lecture: merged } = upsertLecture(current, built.lecture);
      setPreview({
        lecture: built.lecture,
        action,
        filledId,
        fillsDate: merged?.lectureDate ?? null,
        chars: built.lecture.fullText?.length ?? built.lecture.chunks.reduce((n, c) => n + (c.markdown || c.text || "").length, 0),
        quality,
      });
    },
    [blockId, termId, userId]
  );

  /**
   * Objectives are the authoritative curriculum — coverage, quizzes and atom
   * tagging all read them. Re-running replaces this lecture's objectives rather
   * than appending. Takes the lecture so it can run straight after a save,
   * before React has re-rendered with it.
   */
  const extractObjectives = useCallback(
    async (lecture) => {
      const lec = lecture || saved;
      if (!lec) return;
      setProgress("Reading the objectives out of the lecture…");
      try {
        const found = await extractObjectivesFromLecture(lectureText(lec), lec, blockId);
        if (!found.length) {
          setObjectiveResult("No objectives found — no SOM codes and nothing verb-led in the text.");
          return [];
        }

        makeObjectiveCommands(userId).replaceLectureObjectives(blockId, lec.id, found);
        // Authoritative, not the merging push: a re-upload REMOVES the superseded
        // lecture's objectives, and every ordinary push is read-merge-write, so a
        // deletion never leaves the cloud and the next pull walks it back in.
        if (userId) await overwriteObjectivesInCloud(userId, objectivesStore.read(userId) || {});

        const coded = found.filter((o) => String(o.code || "").startsWith("SOM.")).length;
        setObjectiveResult(
          `${found.length} objective${found.length === 1 ? "" : "s"} saved${coded ? ` · ${coded} SOM-coded` : ""}.`
        );
        return found;
      } catch (e) {
        setObjectiveResult("⚠ Objective extraction failed: " + (e?.message || String(e)));
        return [];
      } finally {
        setProgress("");
      }
    },
    [saved, blockId, userId]
  );

  /**
   * The teaching map is what DeepLearn teaches from — its clinicalHook is the
   * case DeepLearn opens with, so a lecture without one teaches with no
   * patient. Written onto the stored lecture, not held in this component.
   */
  const buildTeachingMap = useCallback(
    async (lecture) => {
      const lec = lecture || saved;
      if (!lec) return;
      setProgress("Analyzing the lecture…");
      try {
        const map = await analyzeLecture(lec, lectureText(lec));
        const sections = map?.sections?.length || 0;
        if (!sections) {
          setMapResult("⚠ The analysis came back empty — check the AI key, then run it again.");
          return;
        }

        const teachingMapDate = new Date().toISOString();
        // Body to Firestore, stub to the local row — DeepLearn fetches the body
        // when it opens the lecture.
        const current = lecturesStore.read(userId) || [];
        lecturesStore.write(
          userId,
          current.map((l) =>
            l.id === lec.id ? stripTeachingMap({ ...l, teachingMap: map, teachingMapDate }) : l
          )
        );
        if (userId) await saveLectureToCloud(userId, { ...lec, teachingMap: map, teachingMapDate });
        setSaved((prev) => (prev ? { ...prev, teachingMap: map, teachingMapDate } : prev));
        setMapResult(
          `${sections} section${sections === 1 ? "" : "s"} mapped${map.clinicalHook ? " · clinical hook ready" : ""}.`
        );
      } catch (e) {
        setMapResult("⚠ Analysis failed: " + (e?.message || String(e)));
      } finally {
        setProgress("");
      }
    },
    [saved, userId]
  );

  /**
   * High-yield atoms are what the Quiz button (Today, Lectures, this lecture's
   * Study flow) actually generates questions from. Uploading used to leave a
   * lecture with text but no atoms, so the FIRST quiz attempt always failed
   * with a "not enough lecture text" error that had nowhere to render — this
   * closes that gap by running the same extraction LectureStudyFlow offers
   * manually, right after upload.
   */
  const extractAtomsStep = useCallback(
    async (lecture) => {
      const lec = lecture || saved;
      if (!lec) return;
      const text = lectureText(lec);
      if (text.trim().length < MIN_TEXT) {
        setAtomsResult("Skipped — not enough lecture text to extract from.");
        return [];
      }
      setProgress("Pulling high-yield facts out of the lecture…");
      try {
        const result = await extractAtomsForLecture(
          lec,
          text,
          { callAIJSON, saveAtoms: saveLectureAtoms, userId }
        );
        if (result.error) {
          setAtomsResult("⚠ " + result.error);
          return [];
        }
        setAtomsResult(`${result.atoms.length} atom${result.atoms.length === 1 ? "" : "s"} extracted.`);
        return result.atoms;
      } catch (e) {
        setAtomsResult("⚠ Atom extraction failed: " + (e?.message || String(e)));
        return [];
      } finally {
        setProgress("");
      }
    },
    [saved, userId]
  );

  const buildStudyAssets = useCallback(async (lecture, objectives, atoms) => {
    if (!atoms?.length) return;
    setProgress("Building the study guide and mental map…");
    try {
      const subject = lecture?.lectureTitle || lecture?.title || "this lecture";
      const [guideResult, modelResult] = await Promise.all([
        generateStudyGuide({ objectives, atoms, subject }, { callAIJSON }),
        generateMentalModel({ atoms, subject }, { callAIJSON }),
      ]);
      const made = [];
      if (guideResult.topics?.length) {
        studyGuideStore.write(userId, lecture.id, {
          topics: guideResult.topics.map((text, i) => ({ id: `t${i}`, text, checked: false })),
          generated: Date.now(),
        });
        made.push("study guide");
      }
      if (modelResult.model) {
        mentalModelStore.write(userId, lecture.id, modelResult.model);
        made.push("mental map");
      }
      setAssetsResult(made.length ? `${made.join(" + ")} ready.` : "⚠ Study assets could not be generated.");
    } catch (e) {
      setAssetsResult("⚠ Study assets failed: " + (e?.message || String(e)));
    } finally {
      setProgress("");
    }
  }, [userId]);

  /**
   * Save, then pull everything out of the lecture without being asked. Each AI
   * pass reports into its own line and a failure in one does not stop the
   * other — a lecture with objectives but no teaching map is still useful.
   */
  const addAndProcess = useCallback(async () => {
    if (!preview) return;
    setBusy(true); setError(""); setObjectiveResult(""); setMapResult(""); setAtomsResult(""); setAssetsResult("");
    try {
      const incoming = { ...preview.lecture, lectureDate: lectureDate || null };
      const current = lecturesStore.read(userId) || [];
      // Fill the row that is already there. It holds the schedule's date and
      // week, and its id is what objectives, sessions and completion point at —
      // swapping in a new row throws all of that away.
      const { lectures, lecture: merged, action } = upsertLecture(current, incoming);
      const lecture = merged || incoming;

      setProgress("Saving the full lecture…");
      if (userId) {
        const cloudResult = await saveLectureToCloud(userId, lecture);
        if (!cloudResult?.saved) throw new Error(
          cloudResult?.reason === "oversized"
            ? "The extracted lecture is too large for one cloud document."
            : `Lecture cloud save failed (${cloudResult?.reason || "unknown reason"}).`
        );
      }
      // The full text is already durable in the lecture document. Keeping a
      // second copy in localStorage is what made dense single uploads fail at
      // the button press, before any enrichment could begin.
      lecturesStore.write(
        userId,
        lectures.map((row) => row.id === lecture.id && userId ? toLocalRow(row) : row)
      );

      setDone(
        action === "filled"
          ? `Filled ${lecture.lectureTitle}${lecture.lectureDate ? ` (${lecture.lectureDate})` : ""} with the uploaded content.`
          : `Added ${lecture.lectureTitle}.`
      );
      setPreview(null);
      setSaved(lecture);

      const objectives = await extractObjectives(lecture);
      await buildTeachingMap(lecture);
      const atoms = await extractAtomsStep(lecture);
      await buildStudyAssets(lecture, objectives, atoms);
      onAdded?.(lecture);
    } catch (e) {
      const msg = e?.message || String(e);
      setError(
        /quota/i.test(msg)
          ? "Out of local storage — this lecture's text does not fit. Run the storage compaction, then try again."
          : "Save failed: " + msg
      );
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, [preview, lectureDate, userId, onAdded, extractObjectives, buildTeachingMap, extractAtomsStep, buildStudyAssets]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!busy) onClose?.(); }}>
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Add a lecture</div>
        <div className="mb-4 text-xs text-text-3">
          Drop a PDF in: it goes through marker OCR (local server → Datalab → Mistral, falling back to
          direct text extraction), then objectives and the teaching map are pulled out for you. A .md
          from <span className="font-mono">pdf2md</span> skips the OCR step. Type, number and title
          come from the filename.
        </div>

        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
        {done && <div className="mb-3 font-mono text-[13px] text-good">{done}</div>}
        {progress && <div className="mb-3 font-mono text-[13px] text-text-2">{progress}</div>}

        <label className="mb-3 flex cursor-pointer items-center gap-2 font-mono text-[13px] text-text-2">
          <input
            type="checkbox"
            checked={useLlm}
            onChange={(e) => setUseLlm(e.target.checked)}
            disabled={busy}
            className="accent-accent"
          />
          LLM cleanup (slower, better quality for dense slides)
        </label>

        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{preview?.lecture?.filename || "Choose a lecture .pdf / .md / .txt"}</span>
          <span className="font-mono text-[12px] text-text-3">browse</span>
          <input
            type="file"
            accept=".pdf,.md,.markdown,.txt"
            className="hidden"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }}
          />
        </label>

        {preview && (
          <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3 text-xs text-text-2">
            <div className="font-semibold text-text-1">
              {preview.lecture.lectureType} {preview.lecture.lectureNumber ?? "—"} · {preview.lecture.lectureTitle}
            </div>
            <div className="mt-1 font-mono text-[12px] text-text-3">
              {preview.chars.toLocaleString()} chars · {preview.lecture.chunks.length} chunk
              {preview.lecture.chunks.length === 1 ? "" : "s"}
              {preview.lecture.extractionMethod !== "markdown-upload" &&
                ` · ${preview.lecture.extractionMethod}`}
              {preview.action === "filled" &&
                (preview.fillsDate
                  ? ` · fills the scheduled lecture (${preview.fillsDate})`
                  : " · fills the existing lecture in this slot")}
            </div>
            {preview.quality?.quality === "poor" && (
              <div className="mt-2 text-[13px] text-warn">
                ⚠ {preview.quality.reason}. Convert it with pdf2md instead if the text looks wrong.
              </div>
            )}
            <label className="mt-2 flex items-center gap-2 font-mono text-[12px] text-text-3">
              date (optional — lets Today schedule it)
              <input
                type="date"
                value={lectureDate}
                onChange={(e) => setLectureDate(e.target.value)}
                className="rounded border border-border bg-panel px-1.5 py-0.5 text-[13px] text-text-1"
              />
            </label>
          </div>
        )}

        {saved && (
          <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3">
            <div className="font-mono text-[13px] text-text-3">what came out of it</div>
            <div className={`mt-1 font-mono text-[13px] ${objectiveResult.startsWith("⚠") ? "text-warn" : "text-good"}`}>
              ◇ {objectiveResult || (busy ? "reading objectives…" : "—")}
            </div>
            <div className={`mt-1 font-mono text-[13px] ${mapResult.startsWith("⚠") ? "text-warn" : "text-good"}`}>
              ◈ {mapResult || (busy ? "waiting on the teaching map…" : "—")}
            </div>
            <div className={`mt-1 font-mono text-[13px] ${atomsResult.startsWith("⚠") ? "text-warn" : "text-good"}`}>
              ◆ {atomsResult || (busy ? "extracting high-yield atoms…" : "—")}
            </div>
            <div className={`mt-1 font-mono text-[13px] ${assetsResult.startsWith("⚠") ? "text-warn" : "text-good"}`}>
              ◉ {assetsResult || (busy ? "building study guide + mental map…" : "—")}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => extractObjectives()} disabled={busy}>
                ◇ Objectives again
              </Button>
              <Button variant="outline" onClick={() => buildTeachingMap()} disabled={busy}>
                ◈ Analyze again
              </Button>
              <Button variant="outline" onClick={() => extractAtomsStep()} disabled={busy}>
                ◆ Atoms again
              </Button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={addAndProcess} disabled={!preview || busy}>
            {busy ? "Working…" : preview?.action === "filled" ? "Fill and process" : "Add and process"}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export default AddLectureModal;
