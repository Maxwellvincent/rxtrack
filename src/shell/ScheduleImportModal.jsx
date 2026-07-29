import { useState, useCallback } from "react";
import { Button } from "../ui/Button.jsx";
import { parseSchedule } from "../schedule/scheduleParser.js";
import { scheduleToBlocks } from "../schedule/scheduleToBlocks.js";
import { mergeScheduleIntoStores } from "../schedule/mergeSchedule.js";
import { scheduleToIcs } from "../schedule/scheduleToIcs.js";
import * as termsStore from "../stores/terms.js";
import * as examDatesStore from "../stores/examDates.js";
import * as lecturesStore from "../stores/lectures.js";
import * as assessmentsStore from "../stores/assessments.js";

function downloadIcs(events, name) {
  const ics = scheduleToIcs(events, { calName: name });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = (name || "schedule").replace(/[^\w.-]+/g, "-") + ".ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read schedule .md → block descriptors → preview merge (no writes yet).
 *
 * Every read goes through a store with the real userId. It used to read terms
 * and lectures out of localStorage, exam dates out of a key that is not
 * mirrored there at all, and assessments with `read(null)` — so on a signed-in
 * account the merge was computed against an empty world and reported every
 * existing block as new.
 */
function buildPreview(md, termName, userId) {
  const events = parseSchedule(md);
  const blocks = scheduleToBlocks(events);
  const existing = {
    terms: termsStore.read(userId),
    examDates: examDatesStore.read(userId),
    lectures: lecturesStore.read(userId),
    assessments: assessmentsStore.read(userId),
  };
  const merged = mergeScheduleIntoStores(blocks, existing, { termName });
  return { events, blocks, merged };
}

export function ScheduleImportModal({ userId, termName = "Term 2", onClose }) {
  const [preview, setPreview] = useState(null); // { events, blocks, merged }
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onFile = useCallback(async (file) => {
    setError(""); setPreview(null); setDone(false);
    if (!file) return;
    setFileName(file.name);
    try {
      const md = await file.text();
      const p = buildPreview(md, termName, userId);
      if (!p.blocks.length) throw new Error("No blocks found — is this a schedule .md?");
      setPreview(p);
    } catch (e) { setError(e?.message || String(e)); }
  }, [termName, userId]);

  const confirm = useCallback(async () => {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const { terms, examDates, lectures, assessments } = preview.merged;
      // With the real userId: these stores are Firestore-first and `write(null,
      // …)` is a no-op that just hands the value back, so the import used to
      // persist nothing at all on a signed-in account.
      termsStore.write(userId, terms);
      examDatesStore.write(userId, examDates);
      lecturesStore.write(userId, lectures);
      assessmentsStore.write(userId, assessments);
      setDone(true);
    } catch (e) { setError("Write failed: " + (e?.message || String(e))); }
    finally { setBusy(false); }
  }, [preview, userId]);

  const s = preview?.merged.summary;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 text-lg font-bold text-text-1">Import term schedule</div>
        <div className="mb-4 text-xs text-text-3">
          Upload a schedule <b>.md</b> (from pdf2md). Creates blocks + test dates + lecture slots under <b>{termName}</b>. Preview first — nothing is written until you confirm.
        </div>

        {!done && (
          <label className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm hover:border-border-strong">
            <span className="text-text-2">{fileName || "Choose schedule .md / .txt"}</span>
            <span className="font-mono text-[10px] text-text-3">browse</span>
            <input type="file" accept=".md,.markdown,.txt" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
          </label>
        )}

        {error && <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>}

        {preview && !done && (
          <>
            <div className="mb-3 rounded-lg border border-border bg-bg-elevated p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-3">
                {preview.events.length} of your events · will change:
              </div>
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
                <span>+{s.blocksAdded} blocks</span><span>{s.blocksUpdated} updated</span>
                <span>{s.examDatesSet} test dates</span><span>+{s.lecturesAdded} lecture slots</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {preview.blocks.map((b) => (
                  <div key={b.system} className="flex items-baseline justify-between text-xs">
                    <span className="text-text-1">{b.name}</span>
                    <span className="font-mono text-[10px] text-text-3">
                      {b.lectures.length} lec · start {b.startDate} · test {b.examDate || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={confirm} disabled={busy}>{busy ? "Writing…" : "Confirm & import"}</Button>
              <Button variant="outline" onClick={() => downloadIcs(preview.events, fileName.replace(/\.[^.]+$/, ""))} disabled={busy}>
                ⬇ Download .ics
              </Button>
              <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            </div>
            <div className="mt-2 text-[10px] text-text-3">.ics → Google Calendar: Settings › Import &amp; export › Import.</div>
          </>
        )}

        {done && (
          <div className="space-y-3">
            <div className="rounded-lg border border-good bg-bg-elevated p-3 text-sm text-good">
              ✓ Imported. {s.blocksAdded + s.blocksUpdated} blocks, {s.lecturesAdded} lecture slots, {s.examDatesSet} test dates written to your account.
            </div>
            <Button onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </div>
  );
}
