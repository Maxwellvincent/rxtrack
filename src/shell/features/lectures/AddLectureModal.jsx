/**
 * SP1 T6.1 — adding a lecture from the shell.
 *
 * The markdown path only: convert with pdf2md locally, drop the .md here. App
 * still owns PDF/OCR ingest. Re-adding the same lecture replaces it and
 * tombstones the old id, so a re-upload cannot leave the duplicate that the
 * dedupe work had to clean up.
 */
import { useCallback, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import * as lecturesStore from "../../../stores/lectures.js";
import { pushAllLocalDataToSupabase } from "../../../supabase.js";
import { buildLectureRecord, upsertLecture } from "../../logic/lectureIngest.js";

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

  const onFile = useCallback(
    async (file) => {
      setError(""); setDone(""); setPreview(null);
      if (!file) return;
      const text = await file.text();
      const built = buildLectureRecord({ filename: file.name, text, blockId, termId });
      if (built.error) { setError(built.error); return; }

      const current = lecturesStore.read(userId) || [];
      const { action, replacedId } = upsertLecture(current, built.lecture);
      setPreview({ lecture: built.lecture, action, replacedId, chars: text.length });
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
      onAdded?.(lecture);
    } catch (e) {
      setError("Save failed: " + (e?.message || String(e)));
    } finally {
      setBusy(false);
    }
  }, [preview, lectureDate, userId, onAdded]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Add a lecture</div>
        <div className="mb-4 text-xs text-text-3">
          Convert the PDF with <span className="font-mono">pdf2md</span> first, then drop the .md here. Type, number
          and title are read from the filename. PDF and OCR upload still live in the old shell.
        </div>

        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}
        {done && <div className="mb-3 font-mono text-[11px] text-good">{done}</div>}

        <label className="mb-3 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
          <span className="text-text-2">{preview?.lecture?.filename || "Choose a lecture .md / .txt"}</span>
          <span className="font-mono text-[10px] text-text-3">browse</span>
          <input
            type="file"
            accept=".md,.markdown,.txt"
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
              {preview.action === "replaced" && " · replaces the existing lecture in this slot"}
            </div>
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
