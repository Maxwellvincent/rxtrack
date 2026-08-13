import { useState, useCallback } from "react";
import { Button } from "../../../ui/Button.jsx";
import { extractWithSmartFallback } from "../../../ingest/pdfText.js";
import { extractObjectivesFromStandaloneDoc } from "../../../ingest/objectives.js";
import { flattenEntry, readEntry, storageKeyFor, toEntry } from "../../logic/objectives.js";
import * as objectivesStore from "../../../stores/blockObjectives.js";
import { overwriteObjectivesInCloud } from "../../../supabase.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";

const ACTIVITY_COLORS = {
  LEC: "text-accent",
  DLA: "text-good",
  TBL: "text-warn",
  SG: "text-text-2",
  LAB: "text-text-2",
};

function normKey(text) {
  return (text || "").slice(0, 60).toLowerCase().replace(/\W/g, "");
}


export function ImportObjectivesPdfModal({ blockId, userId, onClose, onImported }) {
  const { data: blockLectures } = useLectures(blockId, userId);
  const { data: existingObjectivesEntry } = useObjectives(blockId, userId);

  const [step, setStep] = useState("idle"); // idle | processing | preview
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  // groups: Array<{ lecId, lecTitle, objectives: Array<{...obj, _duplicate: bool}> }>
  const [groups, setGroups] = useState([]);
  const [totalFound, setTotalFound] = useState(0);
  const [dupCount, setDupCount] = useState(0);

  const onFile = useCallback(
    async (file) => {
      if (!file) return;
      setError("");
      setStep("processing");
      setProgress("Reading file…");

      try {
        let text;
        const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
        if (isPdf) {
          const { contentResult } = await extractWithSmartFallback(
            file,
            (msg) => setProgress(msg),
            { userId }
          );
          text = contentResult?.fullText || "";
        } else {
          text = await file.text();
        }

        setProgress("Extracting objectives…");
        const extracted = await extractObjectivesFromStandaloneDoc(text, blockLectures || [], blockId);
        setTotalFound(extracted.length);

        // Deduplicate against existing objectives
        const existing = Array.isArray(existingObjectivesEntry)
          ? existingObjectivesEntry
          : Object.values(existingObjectivesEntry || {}).flat();
        const existingKeys = new Set(existing.map((o) => normKey(o.objective || o.text)));

        let dups = 0;
        const annotated = extracted.map((obj) => {
          const key = normKey(obj.objective || obj.text);
          const isDup = existingKeys.has(key);
          if (isDup) dups++;
          return { ...obj, _duplicate: isDup };
        });
        setDupCount(dups);

        // Group by matched lecture
        const byLec = new Map(); // lecId → { lecTitle, objectives[] }
        for (const obj of annotated) {
          const lecId = obj.linkedLecId || "imported";
          if (!byLec.has(lecId)) {
            const lec = (blockLectures || []).find((l) => l.id === lecId);
            byLec.set(lecId, {
              lecId,
              lecTitle: lec ? `${lec.lectureType || "LEC"} ${lec.lectureNumber || ""} — ${lec.lectureTitle || lec.id}`.trim() : "Unlinked",
              objectives: [],
            });
          }
          byLec.get(lecId).objectives.push(obj);
        }
        setGroups([...byLec.values()]);
        setStep("preview");
      } catch (e) {
        setError("Failed: " + (e?.message || String(e)));
        setStep("idle");
      } finally {
        setProgress("");
      }
    },
    [blockId, userId, blockLectures, existingObjectivesEntry]
  );

  const newObjectives = groups.flatMap((g) => g.objectives.filter((o) => !o._duplicate));

  const onConfirm = useCallback(async () => {
    if (!newObjectives.length) return;
    // Read store once, flatten existing entries, append non-duplicates, fold back
    // into the original shape (imported/extracted buckets preserved by toEntry).
    const store = objectivesStore.read(userId) || {};
    const existing = flattenEntry(readEntry(store, blockId));
    const existingKeys = new Set(existing.map((o) => normKey(o.objective || o.text)));
    const toAdd = newObjectives
      .map(({ _duplicate, ...clean }) => clean)
      .filter((o) => !existingKeys.has(normKey(o.objective || o.text)));
    if (!toAdd.length) { onImported?.(0); return; }
    const storeKey = storageKeyFor(store, blockId);
    const nextEntry = toEntry(store[storeKey], [...existing, ...toAdd]);
    objectivesStore.write(userId, { ...store, [storeKey]: nextEntry });
    if (userId) {
      try { await overwriteObjectivesInCloud(userId, objectivesStore.read(userId) || {}); } catch { /* non-critical */ }
    }
    onImported?.(toAdd.length);
  }, [newObjectives, blockId, userId, onImported]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-bg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-border px-5 py-4">
          <div className="text-lg font-bold text-text-1">Import objectives PDF</div>
          <div className="mt-0.5 text-xs text-text-3">
            Drop a standalone objectives document — the AI maps each objective to a lecture in this block.
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 rounded-lg border border-bad bg-bg-elevated p-3 text-xs text-bad">
              {error}
            </div>
          )}

          {step === "idle" && (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border px-4 py-8 text-sm hover:border-border-strong">
              <span className="text-text-2">Choose a file to import</span>
              <span className="mt-1 font-mono text-[10px] text-text-3">.pdf · .md · .txt</span>
              <input
                type="file"
                accept=".pdf,.md,.markdown,.txt"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; onFile(f); }}
              />
            </label>
          )}

          {step === "processing" && (
            <div className="py-6 text-center font-mono text-xs text-text-2">{progress || "Working…"}</div>
          )}

          {step === "preview" && (
            <>
              <div className="mb-3 font-mono text-[11px] text-text-2">
                Found{" "}
                <span className="text-text-1">{totalFound}</span> objectives
                {" · "}
                <span className="text-good">{newObjectives.length} new</span>
                {dupCount > 0 && (
                  <> · <span className="text-text-3">{dupCount} duplicate{dupCount === 1 ? "" : "s"} skipped</span></>
                )}
              </div>

              <div className="flex flex-col gap-3">
                {groups.map((group) => {
                  const newInGroup = group.objectives.filter((o) => !o._duplicate);
                  return (
                    <div key={group.lecId} className="rounded-lg border border-border bg-bg-elevated p-3">
                      <div className="mb-2 text-[11px] font-semibold text-text-1">
                        {group.lecTitle}
                        {newInGroup.length < group.objectives.length && (
                          <span className="ml-2 font-normal text-text-3">
                            ({group.objectives.length - newInGroup.length} skipped)
                          </span>
                        )}
                      </div>
                      <ul className="flex flex-col gap-1">
                        {group.objectives.map((obj) => (
                          <li
                            key={obj.id}
                            className={`flex items-start gap-2 text-xs ${obj._duplicate ? "opacity-40 line-through" : "text-text-2"}`}
                          >
                            <span
                              className={`mt-px shrink-0 rounded px-1 font-mono text-[9px] font-bold ${
                                ACTIVITY_COLORS[obj.activity] || "text-text-3"
                              }`}
                            >
                              {obj.activity || "LEC"}
                            </span>
                            <span>{obj.objective || obj.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-border px-5 py-3">
          {step === "preview" && (
            <Button onClick={onConfirm} disabled={newObjectives.length === 0}>
              Import {newObjectives.length} objective{newObjectives.length === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {step === "preview" ? "Cancel" : "Close"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ImportObjectivesPdfModal;
