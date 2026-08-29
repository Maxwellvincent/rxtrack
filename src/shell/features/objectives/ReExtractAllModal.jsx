/**
 * Re-extract objectives from every lecture in a block in one pass.
 *
 * Useful when objectives were lost to a bug or a botched import. Each lecture's
 * existing progress (mastered / developing) is carried forward when the same
 * objective text comes back — only truly-new objectives start as untested.
 */
import { useState, useEffect, useCallback } from "react";
import * as lecturesStore from "../../../stores/lectures.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { overwriteObjectivesInCloud } from "../../../supabase.js";
import { extractObjectivesFromLecture } from "../../../ingest/objectives.js";
import { createObjectiveCommands, selectBlockObjectives } from "../../logic/objectives.js";
import { Button } from "../../../ui/Button.jsx";
import { callAIJSON } from "../../../aiClient.js";
import { tagAtomsWithObjectives } from "../../../engine/tagAtoms.js";
import { saveLectureAtoms } from "../../../supabase.js";
import { startBackgroundJob } from "../../backgroundJobs.js";

/** Normalise objective text for comparison: first 60 chars, lowercase, non-word stripped. */
function normKey(text) {
  return String(text || "").slice(0, 60).toLowerCase().replace(/\W/g, "");
}

/** Pull the raw text out of a lecture record, however it is stored. */
function lecText(lec) {
  if (lec.fullText) return lec.fullText;
  return (lec.chunks || []).map((c) => c.markdown || c.text || "").join("\n\n");
}

function makeObjectiveCommands(userId) {
  return createObjectiveCommands({
    read: () => objectivesStore.read(userId) || {},
    write: (next) => objectivesStore.write(userId, next),
    notify: () => {
      try { window.dispatchEvent(new CustomEvent("rxt-objectives-updated")); } catch { /* non-DOM */ }
    },
  });
}

export function ReExtractAllModal({ blockId, userId, onClose, onDone }) {
  const [lectures, setLectures] = useState([]);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState([]); // per-lecture progress strings
  const [done, setDone] = useState(false);
  const [totalObjectives, setTotalObjectives] = useState(0);
  const [error, setError] = useState("");
  const objectiveLectures = lectures.filter((lecture) => lecText(lecture).trim());

  useEffect(() => {
    const all = lecturesStore.read(userId) || [];
    const forBlock = all.filter((l) => l.blockId === blockId && (l.fullText || l.chunks?.length || l.atoms?.length));
    setLectures(forBlock);
  }, [blockId, userId]);

  const run = useCallback(async () => {
    if (!objectiveLectures.length || running) return;
    setRunning(true);
    setLines([]);
    setError("");
    setDone(false);

    const commands = makeObjectiveCommands(userId);
    let grandTotal = 0;

    try {
      for (let i = 0; i < objectiveLectures.length; i++) {
        const lec = objectiveLectures[i];
        const label = `${lec.lectureType || "LEC"} ${lec.lectureNumber ?? i + 1} — ${lec.lectureTitle || lec.filename || "Untitled"}`;
        setLines((prev) => [...prev, `${label}: extracting…`]);

        try {
          const text = lecText(lec);
          const found = await extractObjectivesFromLecture(text, lec, blockId);

          // Carry forward existing progress for objectives whose text survived.
          if (found.length) {
            const store = objectivesStore.read(userId) || {};
            const existing = selectBlockObjectives(store, blockId);
            // Build a map of normalised text → status for non-untested objectives.
            const progressMap = new Map();
            for (const o of existing) {
              if (o?.linkedLecId === lec.id && o.status && o.status !== "untested") {
                const k = normKey(o.objective || o.text);
                if (k) progressMap.set(k, o.status);
              }
            }
            // Patch incoming objectives with any preserved status.
            const patched = found.map((o) => {
              const k = normKey(o.objective || o.text);
              const carried = k ? progressMap.get(k) : undefined;
              return carried ? { ...o, status: carried } : o;
            });

            commands.replaceLectureObjectives(blockId, lec.id, patched);
            grandTotal += patched.length;
            setLines((prev) => {
              const next = [...prev];
              next[next.length - 1] = `${label}: ${patched.length} objective${patched.length === 1 ? "" : "s"} found`;
              return next;
            });
          } else {
            setLines((prev) => {
              const next = [...prev];
              next[next.length - 1] = `${label}: no objectives found`;
              return next;
            });
          }
        } catch (e) {
          setLines((prev) => {
            const next = [...prev];
            next[next.length - 1] = `${label}: failed — ${e?.message || String(e)}`;
            return next;
          });
        }
      }

      // One authoritative cloud write for the whole batch.
      if (userId) await overwriteObjectivesInCloud(userId, objectivesStore.read(userId) || {});

      setTotalObjectives(grandTotal);
      setDone(true);
    } catch (e) {
      setError("Re-extraction stopped: " + (e?.message || String(e)));
    } finally {
      setRunning(false);
    }
  }, [objectiveLectures, running, blockId, userId]);

  const reconcileAtoms = useCallback(() => {
    const withAtoms = lectures.filter(l => l.atoms?.length);
    startBackgroundJob({
      label: "Objective ↔ atom reconciliation",
      detail: `Starting 0/${withAtoms.length} lectures`,
      run: async (progress) => {
        const allObjectives = selectBlockObjectives(objectivesStore.read(userId) || {}, blockId);
        let linked = 0;
        for (let i = 0; i < withAtoms.length; i++) {
          const lec = withAtoms[i];
          const objectives = allObjectives.filter(o => o.linkedLecId === lec.id);
          progress(`${i + 1}/${withAtoms.length} · ${lec.lectureTitle || lec.fileName || "Lecture"}`);
          if (!objectives.length) continue;
          const result = await tagAtomsWithObjectives(lec.atoms, objectives, { callAIJSON });
          await saveLectureAtoms(userId, lec.id, result.atoms || lec.atoms);
          linked += (result.atoms || []).filter(a => a.objectiveIds?.length).length;
        }
        return `${linked} atom links saved across ${withAtoms.length} lectures. Review candidate mappings in each lecture.`;
      },
    });
    onClose();
  }, [lectures, userId, blockId, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={running ? undefined : onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-lg font-bold text-text-1">Re-extract all objectives</div>
        <div className="mb-4 text-xs text-text-3">
          Runs the objective extractor over every lecture in this block that has text.
          Existing mastered / developing status is preserved when the same objective text comes back.
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">{error}</div>
        )}

        {!running && !done && objectiveLectures.length === 0 && (
          <div className="mb-3 text-xs text-text-3">
            No lectures with text found in this block. Upload lecture content first.
          </div>
        )}

        {!running && !done && objectiveLectures.length > 0 && (
          <div className="mb-4 text-xs text-text-2">
            {objectiveLectures.length} lecture{objectiveLectures.length === 1 ? "" : "s"} with extractable text found.
          </div>
        )}

        {!running && !done && lectures.some(l => l.atoms?.length) && (
          <div className="mb-4 rounded-lg border border-border p-3 text-xs text-text-2">
            <strong className="block text-text-1">Existing atom-objective repair</strong>
            Current lectures may have atoms extracted before objectives were linked. This continues in the background while the website stays open. It keeps atom and objective text unchanged and adds candidate links.
            <Button variant="outline" className="mt-3" onClick={reconcileAtoms}>Reconcile existing atoms</Button>
          </div>
        )}

        {lines.length > 0 && (
          <div className="mb-3 flex-1 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-3">
            {lines.map((line, i) => (
              <div key={i} className="font-mono text-[13px] text-text-2">{line}</div>
            ))}
          </div>
        )}

        {done && (
          <div className="mb-3 font-mono text-[13px] text-good">
            Re-extracted {totalObjectives} objective{totalObjectives === 1 ? "" : "s"} across {objectiveLectures.length} lecture{objectiveLectures.length === 1 ? "" : "s"}.
          </div>
        )}

        <div className="flex gap-2">
          {!done && (
            <Button onClick={run} disabled={running || !objectiveLectures.length}>
              {running
                ? "Extracting…"
                : `Re-extract objectives from ${objectiveLectures.length} lecture${objectiveLectures.length === 1 ? "" : "s"}`}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={done ? onDone : onClose}
            disabled={running}
          >
            {done ? "Close" : "Cancel"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ReExtractAllModal;
