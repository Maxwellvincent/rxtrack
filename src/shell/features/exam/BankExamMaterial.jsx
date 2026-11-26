import { useState } from "react";
import * as meta from "../../../stores/questionBankMeta.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { useBlocks } from "../../hooks/useBlocks.js";
import { markedExamBlockIds, withExamBlock } from "../../logic/bankExamBlocks.js";

/**
 * Mark a school bank as another exam's material (an IMCQ given during NB 3
 * that tests NB 2 lectures). Lecture links do not change.
 */
export function BankExamMaterial({ userId, filename }) {
  const resource = useStoreResource(meta, userId);
  const blocks = useBlocks(userId);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const entry = Object.values(resource.data || {}).find(item => item?.filename === filename);
  if (!entry) return null;
  const marked = markedExamBlockIds(entry);
  const nameOf = id => blocks.find(block => block.id === id)?.name || "another block";
  const filedTerm = blocks.find(block => block.id === entry.blockId)?.termId;
  const options = blocks.filter(block => block.id !== entry.blockId && !marked.includes(block.id) && (!filedTerm || block.termId === filedTerm));
  const save = async (blockId, on) => {
    setBusy(true); setError("");
    try { await meta.writeAwait(userId, withExamBlock(meta.read(userId), filename, blockId, on)); }
    catch (e) { setError(e.message || "Could not save."); }
    finally { setBusy(false); }
  };
  return <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-2">
    {marked.map(id => <span key={id} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5">
      ✓ Also {nameOf(id)} exam material
      <button type="button" disabled={busy} className="underline" aria-label={`Stop counting as ${nameOf(id)} exam material`} onClick={() => save(id, false)}>Remove</button>
    </span>)}
    {options.length > 0 && <label className="inline-flex items-center gap-1">
      Also exam material for
      <select disabled={busy || resource.loading || !!resource.error} value="" onChange={event => event.target.value && save(event.target.value, true)} className="rounded border border-border bg-panel px-1 py-0.5">
        <option value="">Choose a block…</option>
        {options.map(block => <option key={block.id} value={block.id}>{block.name}</option>)}
      </select>
    </label>}
    {error && <span role="alert">✕ {error}</span>}
  </div>;
}
