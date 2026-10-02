/**
 * SP1 T6.1 — adding a lecture from the shell.
 *
 * Markdown (pdf2md locally, drop the .md here) or the PDF itself, which runs
 * through the same extraction chain App uses — marker/datalab/mistral OCR,
 * falling back to pdfplumber. Objectives and supporting lecture facts run
 * after save; quiz targets are selected from objectives.
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
  uploadLectureSource,
} from "../../../supabase.js";
import { stripTeachingMap } from "../../../lectureTeachingMap.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { assessTextQuality, extractWithSmartFallback } from "../../../ingest/pdfText.js";
import { extractObjectivesFromLecture } from "../../../ingest/objectives.js";
import { analyzeLecture } from "../../../ingest/teachingMap.js";
import { createObjectiveCommands, selectBlockObjectives } from "../../logic/objectives.js";
import { extractAtoms as extractAtomsForLecture, MIN_TEXT } from "./lectureStudy.js";
import { callAIJSON } from "../../../aiClient.js";
import { generateStudyGuide } from "../../../engine/studyGuide.js";
import { generateMentalModel } from "../../../engine/mentalModel.js";
import * as studyGuideStore from "../../../stores/studyGuide.js";
import * as mentalModelStore from "../../../stores/mentalModel.js";
import {
  buildLectureRecord,
  buildLectureFromExtraction,
  combineLectureParts,
  appendLectureParts,
  parseLectureFilename,
  upsertLecture,
} from "../../logic/lectureIngest.js";
import { toLocalRow } from "../../logic/bulkIngest.js";
import { startBackgroundJob } from "../../backgroundJobs.js";

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

export function AddLectureModal({ blockId, termId = null, userId = null, onClose, onAdded, targetLecture = null }) {
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
  const [lastFiles, setLastFiles] = useState([]);
  const [combinedTitle, setCombinedTitle] = useState("");

  const onFiles = useCallback(
    async (fileList, overrides = {}) => {
      setError(""); setDone(""); setPreview(null); setProgress("");
      setSaved(null); setObjectiveResult(""); setMapResult("");
      const files = [...(fileList || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      if (!files.length) return;
      setBusy(true);
      setLastFiles(files);
      try {
        const parts = [];
        const qualities = [];
        for (const [index, file] of files.entries()) {
          setProgress(files.length > 1 ? `Reading part ${index + 1}/${files.length}: ${file.name}` : `Reading ${file.name}`);
          const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
          let built;
          if (isPdf) {
            const { contentResult, method } = await extractWithSmartFallback(
              file,
              (msg) => setProgress(files.length > 1 ? `Part ${index + 1}/${files.length} · ${msg}` : msg),
              { detectNumber: (name) => parseLectureFilename(name).number, userId, useLlm: overrides.useLlm ?? useLlm }
            );
            qualities.push(assessTextQuality(contentResult?.fullText || ""));
            built = buildLectureFromExtraction({ filename: file.name, contentResult, method, blockId, termId });
          } else {
            built = buildLectureRecord({ filename: file.name, text: await file.text(), blockId, termId });
          }
          if (built.error) throw new Error(`${file.name}: ${built.error}`);
          parts.push({ filename: file.name, file, lecture: built.lecture });
        }
        const combined = combineLectureParts(parts);
        if (combined.error) throw new Error(combined.error);
        const current = lecturesStore.read(userId) || [];
        const { action, filledId, lecture: merged } = upsertLecture(current, combined.lecture, {
          targetId: targetLecture?.id || null,
        });
        const existing = filledId ? current.find((row) => row.id === filledId) : null;
        const combinedLecture = existing && ((existing.chunks || []).length || existing.fullText)
          ? appendLectureParts(existing, { ...combined.lecture, id: filledId })
          : { ...combined.lecture, ...(filledId ? { id: filledId } : {}) };
        setCombinedTitle(combined.lecture.lectureTitle);
        setPreview({
          lecture: combinedLecture || merged,
          sourceFiles: parts.map((part) => ({ file: part.file, filename: part.filename })),
          action,
          filledId,
          fillsDate: merged?.lectureDate ?? null,
          chars: combinedLecture.fullText?.length ?? combinedLecture.chunks.reduce((n, c) => n + (c.markdown || c.text || "").length, 0),
          quality: qualities.find((quality) => quality?.quality === "poor") || null,
        });
      } catch (e) {
        setError("Could not read selected lecture file(s): " + (e?.message || String(e)));
      } finally {
        setBusy(false);
        setProgress("");
      }
    },
    [blockId, termId, userId, useLlm, targetLecture]
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
      // A source-PDF refresh must not replace the school's linked objectives
      // with whatever an extractor happens to infer from slide text. Those
      // links are the curriculum/progress source of truth.
      if (targetLecture) {
        const linked = selectBlockObjectives(objectivesStore.read(userId) || {}, blockId)
          .filter((objective) => objective?.linkedLecId === lec.id ||
            (lec.mergedFrom || []).some((source) => source?.id === objective?.linkedLecId));
        if (linked.length) {
          setObjectiveResult(`${linked.length} existing school objective${linked.length === 1 ? " link" : " links"} preserved; source refresh did not replace them.`);
          return linked;
        }
      }
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
    [saved, blockId, userId, targetLecture]
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
    async (lecture, throwOnFailure = false, reportProgress = null) => {
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
          { callAIJSON, saveAtoms: saveLectureAtoms, userId, onProgress: message => { setProgress(message); reportProgress?.(message); } }
        );
        if (result.error) {
          throw new Error(result.error);
        }
        setAtomsResult(`${result.atoms.length} atom${result.atoms.length === 1 ? "" : "s"} extracted.${result.warning ? ` ${result.warning}` : ""}`);
        return result.atoms;
      } catch (e) {
        setAtomsResult("⚠ Atom extraction failed: " + (e?.message || String(e)));
        if (throwOnFailure) throw e;
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
        generateMentalModel({ atoms, objectives, subject }, { callAIJSON }),
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
    setBusy(true); setError(""); setObjectiveResult(""); setAtomsResult(""); setAssetsResult("");
    try {
      const incoming = { ...preview.lecture, lectureDate: lectureDate || null };
      const current = lecturesStore.read(userId) || [];
      // Fill the row that is already there. It holds the schedule's date and
      // week, and its id is what objectives, sessions and completion point at —
      // swapping in a new row throws all of that away.
      const { lectures, lecture: merged, action } = upsertLecture(current, incoming, {
        targetId: targetLecture?.id || null,
      });
      let lecture = merged || incoming;

      setProgress("Saving the full lecture…");
      if (userId) {
        const uploadedSources = [];
        for (const source of preview.sourceFiles || []) {
          if (source.file?.type === "application/pdf" || /\.pdf$/i.test(source.filename || "")) {
            const storagePath = await uploadLectureSource(userId, lecture.id, source.file);
            uploadedSources.push({ filename: source.filename, storagePath });
          }
        }
        const uploadedByName = new Map(uploadedSources.map((source) => [source.filename, source.storagePath]));
        const sourceFiles = (lecture.sourceFiles || []).map((source) => ({
          ...source,
          ...(uploadedByName.has(source.filename) ? { storagePath: uploadedByName.get(source.filename) } : {}),
        }));
        lecture = {
          ...lecture,
          sourceFiles,
          ...(uploadedSources[0]?.storagePath ? { sourceStoragePath: uploadedSources[0].storagePath } : {}),
        };
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
        lectures.map((row) => row.id === lecture.id && userId ? toLocalRow({ ...row, sourceStoragePath: lecture.sourceStoragePath, sourceFiles: lecture.sourceFiles }) : row)
      );

      setDone(
        action === "filled"
          ? `Filled ${lecture.lectureTitle}${lecture.lectureDate ? ` (${lecture.lectureDate})` : ""} with the uploaded content.`
          : `Added ${lecture.lectureTitle}.`
      );
      setPreview(null);
      setSaved(lecture);

      startBackgroundJob({
        label: `Processing ${lecture.lectureTitle}`,
        detail: "Reading objectives…",
        run: async (update) => {
          const objectives = await extractObjectives(lecture);
          update(`Mapped ${objectives.length} objectives · extracting supporting facts…`);
          update("Extracting high-yield atoms…");
          const atoms = await extractAtomsStep(lecture, false, update);
          if (atoms.length) {
            update(`${atoms.length} supporting facts · building optional study assets…`);
            await buildStudyAssets(lecture, objectives, atoms);
          } else {
            setAssetsResult("Skipped — objective-based quiz generation can still use the lecture content.");
          }
          onAdded?.(lecture);
          return `${objectives.length} objectives · ${atoms.length} supporting facts`;
        },
      });
      onClose?.();
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
  }, [preview, lectureDate, userId, onAdded, extractObjectives, extractAtomsStep, buildStudyAssets, targetLecture]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!busy) onClose?.(); }}>
      <div className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">{targetLecture ? "Re-extract lecture" : "Add a lecture"}</div>
        <div className="mb-4 text-xs text-text-3">
          {targetLecture ? `Add or combine source parts for “${targetLecture.lectureTitle || targetLecture.filename || "this lecture"}”. ` : "Choose one file, or select multiple PDFs/notes that are parts of the same lecture. "}Selected files are combined into one lecture record, in filename order; original PDFs are kept as separate sources. PDFs use the local pdftotext layer first, then Marker/Mistral OCR as needed. A .md
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
          <span className="text-text-2">{preview?.sourceFiles?.length ? `${preview.sourceFiles.length} source file${preview.sourceFiles.length === 1 ? "" : "s"} selected` : "Choose lecture files .pdf / .md / .txt"}</span>
          <span className="font-mono text-[12px] text-text-3">browse</span>
          <input
            type="file"
            accept=".pdf,.md,.markdown,.txt"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ""; if (files.length > 1) setCombinedTitle(""); onFiles(files); }}
          />
        </label>

        {preview && (
          <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3 text-xs text-text-2">
            <div className="font-semibold text-text-1">
              {preview.lecture.lectureType} {preview.lecture.lectureNumber ?? "—"} · {preview.lecture.lectureTitle}
            </div>
            <label className="mt-2 block text-xs text-text-3">Logical lecture title
              <input value={combinedTitle} onChange={(event) => {
                const value = event.target.value;
                setCombinedTitle(value);
                setPreview((current) => current ? { ...current, lecture: { ...current.lecture, lectureTitle: value } } : current);
              }} className="mt-1 w-full rounded border border-border bg-panel px-2 py-1 text-sm text-text-1" />
            </label>
            <ul className="mt-2 list-inside list-disc text-text-3">{preview.sourceFiles.map((source) => <li key={source.filename}>{source.filename}</li>)}</ul>
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
                ⚠ {preview.quality.reason}. Try the recovery pass below if the lecture is image-heavy or the text looks wrong.
                {lastFiles.length > 0 && <button type="button" className="ml-2 underline" disabled={busy} onClick={() => { setUseLlm(true); onFiles(lastFiles, { useLlm: true }); }}>retry selected files with LLM cleanup</button>}
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
