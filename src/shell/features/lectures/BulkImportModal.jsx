/**
 * SP1 — import a whole folder of lectures in one pass.
 *
 * Convert the folder first (`pdf2md "C:\path\to\folder"` runs marker over every
 * PDF on the GPU, free and with no upload), then drop the .md files here. PDFs
 * are accepted too and go through the OCR chain one at a time, which is far
 * slower and bills per page.
 *
 * The text is written to Firestore and the local row is kept chunk-light: a
 * hundred decks of lecture text does not fit in the ~5MB localStorage quota.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import * as lecturesStore from "../../../stores/lectures.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { overwriteObjectivesInCloud, saveLectureToCloud } from "../../../supabase.js";
import { assessTextQuality, extractWithSmartFallback } from "../../../ingest/pdfText.js";
import { extractObjectivesFromLecture } from "../../../ingest/objectives.js";
import { analyzeLecture } from "../../../ingest/teachingMap.js";
import { createObjectiveCommands } from "../../logic/objectives.js";
import {
  buildLectureRecord,
  buildLectureFromExtraction,
  parseLectureFilename,
} from "../../logic/lectureIngest.js";
import {
  applyToLectures,
  planBulkImport,
  runQueue,
  selectBestFiles,
  summarizePlan,
  toLocalRow,
} from "../../logic/bulkIngest.js";

const STATUS_LABEL = {
  queued: "queued",
  reading: "reading",
  objectives: "objectives…",
  map: "teaching map…",
  done: "done",
  error: "failed",
};

export function BulkImportModal({ blockId, termId = null, userId = null, onClose, onImported }) {
  const [plan, setPlan] = useState([]);
  const [rows, setRows] = useState({}); // filename -> { status, note }
  const [running, setRunning] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const cancelled = useRef(false);

  const counts = useMemo(() => summarizePlan(plan), [plan]);

  const onFiles = useCallback(
    (fileList) => {
      setError(""); setSummary(""); setRows({});
      const raw = Array.from(fileList || []);
      // A folder pick that produces nothing is indistinguishable from a dead
      // button, so say what arrived.
      console.log("[bulk-import] files handed over:", raw.length, raw.slice(0, 3).map((f) => f.webkitRelativePath || f.name));
      if (!raw.length) {
        setError("The picker returned no files. If Chrome asked to upload and the prompt was dismissed, try again and confirm it.");
        return;
      }
      // Pick the folder and you get the PDFs, the markdown and marker's
      // per-document subfolders all at once; keep one file per lecture.
      const files = selectBestFiles(raw);
      if (!files.length) {
        setError(`Nothing importable in those ${raw.length} files — expected .md, .txt or .pdf.`);
        return;
      }
      setSkipped(raw.length - files.length);
      const existing = lecturesStore.read(userId) || [];
      const next = planBulkImport(files, existing.filter((l) => l.blockId === blockId), blockId);
      console.log("[bulk-import] kept", files.length, "of", raw.length, "→ planned", next.length);
      if (!next.length) {
        setError(`Could not read a lecture number or title from any of those ${files.length} files.`);
        return;
      }
      setPlan(next);
    },
    [blockId, userId]
  );

  const setRow = useCallback((filename, patch) => {
    setRows((prev) => ({ ...prev, [filename]: { ...(prev[filename] || {}), ...patch } }));
  }, []);

  /** One lecture, end to end. Throws so the queue can record the failure. */
  const importOne = useCallback(
    async (entry) => {
      if (cancelled.current) throw new Error("cancelled");
      setRow(entry.filename, { status: "reading" });

      const isPdf = /\.pdf$/i.test(entry.filename) || entry.file.type === "application/pdf";
      let built;
      if (isPdf) {
        const { contentResult, method } = await extractWithSmartFallback(entry.file, null, {
          detectNumber: (name) => parseLectureFilename(name).number,
          userId,
        });
        const quality = assessTextQuality(contentResult?.fullText || "");
        built = buildLectureFromExtraction({ filename: entry.filename, contentResult, method, blockId, termId });
        if (quality?.quality === "poor") setRow(entry.filename, { note: quality.reason });
      } else {
        built = buildLectureRecord({ filename: entry.filename, text: await entry.file.text(), blockId, termId });
      }
      if (built.error) throw new Error(built.error);

      const text = built.lecture.fullText || (built.lecture.chunks || []).map((c) => c.markdown || c.text || "").join("\n\n");

      // Fill the scheduled row rather than replacing it: it carries the date
      // Today plans from, and its id is what objectives and sessions point at.
      const current = lecturesStore.read(userId) || [];
      const { lectures, lecture: merged, action } = applyToLectures(current, built.lecture);
      const lecture = merged || built.lecture;
      lecturesStore.write(userId, lectures.map((l) => (l.id === lecture.id ? toLocalRow(l) : l)));

      // Text to the cloud, chunk-light row locally.
      if (userId) await saveLectureToCloud(userId, lecture);
      setRow(entry.filename, { note: action === "filled" ? "filled the scheduled lecture" : "" });

      const commands = createObjectiveCommands({
        read: () => objectivesStore.read(userId) || {},
        write: (next) => objectivesStore.write(userId, next),
        notify: () => { try { window.dispatchEvent(new CustomEvent("rxt-objectives-updated")); } catch { /* non-DOM */ } },
      });
      setRow(entry.filename, { status: "objectives" });
      let objectiveCount = 0;
      try {
        const found = await extractObjectivesFromLecture(text, lecture, blockId);
        objectiveCount = found.length;
        if (found.length) commands.replaceLectureObjectives(blockId, lecture.id, found);
      } catch (e) {
        setRow(entry.filename, { note: "objectives failed: " + (e?.message || String(e)) });
      }

      setRow(entry.filename, { status: "map" });
      let sections = 0;
      try {
        const map = await analyzeLecture(lecture, text);
        sections = map?.sections?.length || 0;
        if (sections) {
          const teachingMapDate = new Date().toISOString();
          // The map has to live on the LOCAL row as well as in the cloud:
          // DeepLearn reads lec.teachingMap straight off the store, so a
          // cloud-only copy teaches with no clinical hook. It is a few KB of
          // prose, unlike the chunks, so it fits.
          const rows = lecturesStore.read(userId) || [];
          lecturesStore.write(
            userId,
            rows.map((l) => (l.id === lecture.id ? { ...l, teachingMap: map, teachingMapDate } : l))
          );
          if (userId) await saveLectureToCloud(userId, { ...lecture, teachingMap: map, teachingMapDate });
        }
      } catch (e) {
        setRow(entry.filename, { note: "teaching map failed: " + (e?.message || String(e)) });
      }

      setRow(entry.filename, { status: "done", note: `${objectiveCount} objectives · ${sections} sections` });
      return { objectiveCount, sections };
    },
    [blockId, termId, userId, setRow]
  );

  const run = useCallback(async () => {
    if (!plan.length) return;
    cancelled.current = false;
    setRunning(true); setError(""); setSummary("");
    try {
      const results = await runQueue(plan, importOne, { concurrency: 3 });
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      for (const f of failed) setRow(f.item.filename, { status: "error", note: f.error });

      // One authoritative objectives write for the whole batch: the ordinary
      // push is read-merge-write, so the objectives a replace removed would
      // otherwise walk straight back in on the next pull.
      if (userId) await overwriteObjectivesInCloud(userId, objectivesStore.read(userId) || {});

      setSummary(
        `${ok.length} imported${failed.length ? `, ${failed.length} failed` : ""} · ` +
        `${ok.reduce((n, r) => n + (r.value?.objectiveCount || 0), 0)} objectives in total.`
      );
      onImported?.();
    } catch (e) {
      setError("Import stopped: " + (e?.message || String(e)));
    } finally {
      setRunning(false);
    }
  }, [plan, importOne, userId, setRow, onImported]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={running ? undefined : onClose}>
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Import a folder of lectures</div>
        <div className="mb-3 text-xs text-text-3">
          Point this at the folder you converted. It takes one file per lecture, preferring the markdown over
          the source PDF, and ignores marker&apos;s per-document subfolders — so a folder holding PDFs, markdown
          and subfolders all at once still imports cleanly. A lecture with no markdown yet falls back to OCR on
          its PDF, which is minutes rather than a fraction of a second. Objectives and the teaching map then run
          for every lecture, three at a time.
        </div>

        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
        {summary && <div className="mb-3 font-mono text-[11px] text-good">{summary}</div>}

        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
            <span className="text-text-2">Choose the whole folder</span>
            <span className="font-mono text-[10px] text-text-3">folder</span>
            <input
              type="file"
              webkitdirectory=""
              directory=""
              className="hidden"
              disabled={running}
              // Copy before resetting the input: e.target.files is a LIVE
              // FileList, so clearing the value empties the very list just
              // captured and the handler sees nothing.
              onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs); }}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
            <span className="text-text-2">Pick files instead</span>
            <span className="font-mono text-[10px] text-text-3">files</span>
            <input
              type="file"
              multiple
              accept=".pdf,.md,.markdown,.txt"
              className="hidden"
              disabled={running}
              onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ""; onFiles(fs); }}
            />
          </label>
        </div>
        {plan.length > 0 && (
          <div className="mb-3 font-mono text-[11px] text-text-3">
            {counts.total} lectures{skipped > 0 && ` · ignored ${skipped} other files (source PDFs, images, marker subfolders)`}
          </div>
        )}

        {plan.length > 0 && (
          <>
            <div className="mb-2 font-mono text-[11px] text-text-3">
              {counts.fill} filling an existing lecture ({counts.dated} of them scheduled) · {counts.add} new
            </div>
            <div className="mb-3 flex-1 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-left text-[11px]">
                <tbody>
                  {plan.map((p) => {
                    const row = rows[p.filename] || {};
                    const status = row.status || "queued";
                    return (
                      <tr key={p.filename} className="border-b border-border last:border-0">
                        <td className="px-2 py-1 font-mono text-text-3">{p.lectureType} {p.lectureNumber ?? "—"}</td>
                        <td className="px-2 py-1 text-text-1">{p.lectureTitle}</td>
                        <td className="px-2 py-1 font-mono text-text-3">
                          {p.action === "fill" ? (p.fillsDate ? `fill · ${p.fillsDate}` : "fill") : "new"}
                        </td>
                        <td className={`px-2 py-1 font-mono ${status === "error" ? "text-bad" : status === "done" ? "text-good" : "text-text-2"}`}>
                          {STATUS_LABEL[status]}
                        </td>
                        <td className="px-2 py-1 font-mono text-text-3">{row.note || ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex gap-2">
          <Button onClick={run} disabled={!plan.length || running}>
            {running ? "Importing…" : `Import ${counts.total || ""}`.trim()}
          </Button>
          {running && (
            <Button variant="outline" onClick={() => { cancelled.current = true; }}>
              Stop after the current ones
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={running}>Close</Button>
        </div>
      </div>
    </div>
  );
}

export default BulkImportModal;
