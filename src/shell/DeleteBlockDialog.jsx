import { useMemo, useState } from "react";
import * as termsStore from "../stores/terms.js";
import * as lecturesStore from "../stores/lectures.js";
import * as objectivesStore from "../stores/blockObjectives.js";
import { blockBackup, deleteBlock, planBlockDeletion } from "./logic/deleteBlock.js";

function downloadJson(filename, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 1)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Confirm and delete one block. A backup file (lectures with their text, and
 * objectives) is downloaded first; typing the block name enables the delete.
 */
export function DeleteBlockDialog({ userId, blockId, onClose, onDeleted, deps = {} }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const terms = deps.terms || termsStore;
  const lectures = deps.lectures || lecturesStore;
  const objectives = deps.objectives || objectivesStore;
  const snapshot = useMemo(() => ({
    terms: terms.read(userId) || [],
    lectures: lectures.read(userId) || [],
    objectives: objectives.read(userId) || {},
  }), [terms, lectures, objectives, userId]);
  const plan = useMemo(() => planBlockDeletion({ blockId, ...snapshot }), [blockId, snapshot]);
  const name = plan.block?.name || "";
  const confirmed = !!name && typed.trim() === name;

  const run = async () => {
    setError("");
    try {
      setBusy("Saving a backup file…");
      const backup = await (deps.backup || blockBackup)({ userId, blockId, ...snapshot });
      (deps.download || downloadJson)(`rxtrack-block-${name.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}.json`, backup);
      setBusy("Deleting…");
      await (deps.deleteBlock || deleteBlock)({ userId, blockId }, deps);
      onDeleted?.(blockId);
    } catch (e) {
      setError(e?.message || String(e));
      setBusy("");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="delete-block-title" className="w-full max-w-lg rounded-lg border border-border bg-panel p-5 shadow-xl">
        <h2 id="delete-block-title" className="text-lg font-semibold text-text-1">Delete block{name ? ` “${name}”` : ""}</h2>
        {!plan.block ? <p className="mt-2 text-sm text-text-2">Select the block to delete in the sidebar first.</p> : <>
          <p className="mt-2 text-sm text-text-2">This permanently removes:</p>
          <ul className="mt-1 list-inside list-disc text-sm text-text-1">
            <li>{plan.lectureCount} lecture{plan.lectureCount === 1 ? "" : "s"}, with their text and extracted facts</li>
            <li>{plan.objectiveCount} objective{plan.objectiveCount === 1 ? "" : "s"}</li>
            <li>the block from your term list</li>
          </ul>
          {plan.objectivesWithAttempts > 0 && <p role="alert" className="mt-2 text-sm text-warn">⚠ {plan.objectivesWithAttempts} of these objectives have practice on record. That history stays stored but will no longer show anywhere.</p>}
          <p className="mt-2 text-sm text-text-3">A backup file downloads first. It cannot be undone from inside the app.</p>
          <label className="mt-4 block text-xs text-text-2">Type <strong className="text-text-1">{name}</strong> to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={!!busy} aria-label="Block name to confirm" className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text-1" />
          </label>
        </>}
        {busy && <p role="status" className="mt-3 text-sm text-text-2">{busy}</p>}
        {error && <p role="alert" className="mt-3 text-sm text-bad">✕ {error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={!!busy} onClick={onClose} className="rounded border border-border px-3 py-2 text-sm">Cancel</button>
          <button type="button" disabled={!confirmed || !!busy} onClick={run} className="rounded bg-bad px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Delete block</button>
        </div>
      </section>
    </div>
  );
}
