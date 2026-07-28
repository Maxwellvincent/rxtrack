/**
 * SP1 T6.1 — adding a lecture from the shell.
 *
 * Markdown (pdf2md locally, drop the .md here) or the PDF itself, which runs
 * through the same extraction chain App uses — marker/datalab/mistral OCR,
 * falling back to pdfplumber. What App still owns is the AI enrichment after
 * extraction: objectives, teaching map, subtopics.
 *
 * Re-adding the same lecture replaces it and tombstones the old id, so a
 * re-upload cannot leave the duplicate that the dedupe work had to clean up.
 */
import { useCallback, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import * as lecturesStore from "../../../stores/lectures.js";
import { pushAllLocalDataToSupabase } from "../../../supabase.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { assessTextQuality, extractWithSmartFallback } from "../../../ingest/pdfText.js";
import { extractObjectivesFromLecture } from "../../../ingest/objectives.js";
import { analyzeLecture } from "../../../ingest/teachingMap.js";
import { createObjectiveCommands } from "../../logic/objectives.js";
import {
  buildLectureRecord,
  buildLectureFromExtraction,
  parseLectureFilename,
  upsertLecture,
} from "../../logic/lectureIngest.js";

/** Text the objective extractor reads: whatever the record actually carries. */
function lectureText(lecture) {
  if (lecture?.fullText) return lecture.fullText;
  return (lecture?.chunks || []).map((c) => c.markdown || c.text || "").join("\n\n");
}

/** Same list App writes, so a superseded lecture stays deleted after a sync. */
function tombstone(lecture) {
  if (!lecture?.id) return;
  try {
    const raw = JSON.parse(localStorage.getItem("rxt-id-tombstones") || "[]");
    const list = Array.isArray(raw) ? raw : [];
    list.push({
      oldId: lecture.id,
      blockId: lecture.blockId,
      lectureType: lecture.lectureType,
      lectureNumber: String(lecture.lectureNumber),
      deletedAt: new Date().toISOString(),
    });
    localStorage.setItem("rxt-id-tombstones", JSON.stringify(list.slice(-50)));
  } catch { /* best effort */ }
}

export function AddLectureModal({ blockId, termId = null, userId = null, onClose, onAdded }) {
  const [preview, setPreview] = useState(null); // { lecture, action, replacedId }
  const [lectureDate, setLectureDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [progress, setProgress] = useState("");
  const [saved, setSaved] = useState(null);            // the lecture just written
  const [objectiveResult, setObjectiveResult] = useState("");
  const [mapResult, setMapResult] = useState("");

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
            { detectNumber: (name) => parseLectureFilename(name).number }
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
      const { action, replacedId } = upsertLecture(current, built.lecture);
      setPreview({
        lecture: built.lecture,
        action,
        replacedId,
        chars: built.lecture.fullText?.length ?? built.lecture.chunks.reduce((n, c) => n + (c.markdown || c.text || "").length, 0),
        quality,
      });
    },
    [blockId, termId, userId]
  );

  const confirm = useCallback(async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const lecture = { ...preview.lecture, lectureDate: lectureDate || null };
      const current = lecturesStore.read(userId) || [];
      const { lectures, replacedId } = upsertLecture(current, lecture);

      if (replacedId) tombstone(current.find((l) => l.id === replacedId));
      lecturesStore.write(userId, lectures);
      if (userId) await pushAllLocalDataToSupabase(userId);

      setDone(`${preview.action === "replaced" ? "Replaced" : "Added"} ${lecture.lectureTitle}.`);
      setPreview(null);
      setSaved(lecture);
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
    }
  }, [preview, lectureDate, userId, onAdded]);

  /**
   * Objectives are the authoritative curriculum, so this runs as its own step
   * rather than silently on save: it costs a model call and the count is worth
   * seeing. Re-running replaces this lecture's objectives, never appends.
   */
  const extractObjectives = useCallback(async () => {
    if (!saved) return;
    setBusy(true); setError(""); setProgress("Reading the objectives out of the lecture…");
    try {
      const found = await extractObjectivesFromLecture(lectureText(saved), saved, blockId);
      if (!found.length) {
        setObjectiveResult("No objectives found in that lecture — no codes and nothing verb-led.");
        return;
      }

      const commands = createObjectiveCommands({
        read: () => objectivesStore.read(userId) || {},
        write: (next) => objectivesStore.write(userId, next),
        notify: () => { try { window.dispatchEvent(new CustomEvent("rxt-objectives-updated")); } catch { /* non-DOM */ } },
      });
      commands.replaceLectureObjectives(blockId, saved.id, found);
      if (userId) await pushAllLocalDataToSupabase(userId);

      const coded = found.filter((o) => String(o.code || "").startsWith("SOM.")).length;
      setObjectiveResult(
        `${found.length} objective${found.length === 1 ? "" : "s"} saved${coded ? ` · ${coded} SOM-coded` : ""}.`
      );
    } catch (e) {
      setError("Objective extraction failed: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, [saved, blockId, userId]);

  /**
   * The teaching map is what DeepLearn teaches from — its clinicalHook is the
   * case DeepLearn opens with, so a lecture without one teaches with no
   * patient. Written onto the stored lecture, not held in this component.
   */
  const buildTeachingMap = useCallback(async () => {
    if (!saved) return;
    setBusy(true); setError(""); setProgress("Analyzing the lecture…");
    try {
      const map = await analyzeLecture(saved, lectureText(saved));
      const sections = map?.sections?.length || 0;
      if (!sections) {
        setMapResult("The analysis came back empty — check the AI key, then try again.");
        return;
      }

      const teachingMapDate = new Date().toISOString();
      const current = lecturesStore.read(userId) || [];
      lecturesStore.write(
        userId,
        current.map((l) => (l.id === saved.id ? { ...l, teachingMap: map, teachingMapDate } : l))
      );
      setSaved((prev) => (prev ? { ...prev, teachingMap: map, teachingMapDate } : prev));
      if (userId) await pushAllLocalDataToSupabase(userId);

      setMapResult(
        `${sections} section${sections === 1 ? "" : "s"} mapped${map.clinicalHook ? " · clinical hook ready" : ""}.`
      );
    } catch (e) {
      setError("Analysis failed: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }, [saved, userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Add a lecture</div>
        <div className="mb-4 text-xs text-text-3">
          Drop the PDF in and it runs through OCR here, or convert it with{" "}
          <span className="font-mono">pdf2md</span> first and drop the .md — that path is faster and needs no AI.
          Type, number and title are read from the filename.
        </div>

        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
        {done && <div className="mb-3 font-mono text-[11px] text-good">{done}</div>}
        {progress && <div className="mb-3 font-mono text-[11px] text-text-2">{progress}</div>}

        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{preview?.lecture?.filename || "Choose a lecture .pdf / .md / .txt"}</span>
          <span className="font-mono text-[10px] text-text-3">browse</span>
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
            <div className="mt-1 font-mono text-[10px] text-text-3">
              {preview.chars.toLocaleString()} chars · {preview.lecture.chunks.length} chunk
              {preview.lecture.chunks.length === 1 ? "" : "s"}
              {preview.lecture.extractionMethod !== "markdown-upload" &&
                ` · ${preview.lecture.extractionMethod}`}
              {preview.action === "replaced" && " · replaces the existing lecture in this slot"}
            </div>
            {preview.quality?.quality === "poor" && (
              <div className="mt-2 text-[11px] text-warn">
                ⚠ {preview.quality.reason}. Convert it with pdf2md instead if the text looks wrong.
              </div>
            )}
            <label className="mt-2 flex items-center gap-2 font-mono text-[10px] text-text-3">
              date (optional — lets Today schedule it)
              <input
                type="date"
                value={lectureDate}
                onChange={(e) => setLectureDate(e.target.value)}
                className="rounded border border-border bg-panel px-1.5 py-0.5 text-[11px] text-text-1"
              />
            </label>
          </div>
        )}

        {saved && (
          <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3">
            <div className="text-xs text-text-2">
              Two AI passes worth running now: objectives are the curriculum this block is graded on
              (coverage, quizzes and tagging all read them), and the teaching map is what DeepLearn
              teaches from.
            </div>
            {objectiveResult && (
              <div className="mt-2 font-mono text-[11px] text-good">{objectiveResult}</div>
            )}
            {mapResult && <div className="mt-1 font-mono text-[11px] text-good">{mapResult}</div>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" onClick={extractObjectives} disabled={busy}>
                {objectiveResult ? "◇ Extract again" : "◇ Extract objectives"}
              </Button>
              <Button variant="outline" onClick={buildTeachingMap} disabled={busy}>
                {mapResult ? "◈ Analyze again" : "◈ Build teaching map"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={confirm} disabled={!preview || busy}>
            {busy ? "Saving…" : preview?.action === "replaced" ? "Replace lecture" : "Add lecture"}
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export default AddLectureModal;
