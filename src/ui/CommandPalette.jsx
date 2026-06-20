import { useState, useEffect, useRef } from "react";
import { fuzzyFilter } from "../shell/fuzzy.js";
import { Input } from "./Input.jsx";

/** ⌘K palette: filter + pick. Hand-rolled overlay (keyboard: Esc closes, Enter picks first). */
export function CommandPalette({ open, onClose, items, onPick }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const results = fuzzyFilter(items, q).slice(0, 8);
  const selClamped = Math.min(sel, Math.max(0, results.length - 1));
  const choose = (r) => { if (r) { onPick(r); onClose(); } };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-20" onClick={onClose}>
      <div className="w-[420px] rounded-xl border border-border-strong bg-panel p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          placeholder="Jump to a block or command…"
          onKeyDown={(e) => {
            if (e.key === "Escape") { onClose(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(results[selClamped]); }
          }}
        />
        <div className="mt-1 max-h-72 overflow-y-auto">
          {results.length === 0 && <div className="px-3 py-2 text-xs text-text-3">No matches</div>}
          {results.map((r, i) => {
            const isSel = i === selClamped;
            return (
              <button
                key={r.id}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(r)}
                className={
                  "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm font-mono " +
                  (isSel ? "bg-accent-soft text-text-1" : "text-text-2")
                }
              >
                <span>{r.label}</span>
                {r.hint && <span className="text-text-3 text-xs">{r.hint}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
