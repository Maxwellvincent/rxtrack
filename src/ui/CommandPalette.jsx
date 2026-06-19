import { useState, useEffect, useRef } from "react";
import { fuzzyFilter } from "../shell/fuzzy.js";
import { Input } from "./Input.jsx";

/** ⌘K palette: filter + pick. Hand-rolled overlay (keyboard: Esc closes, Enter picks first). */
export function CommandPalette({ open, onClose, items, onPick }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(() => { if (open) { setQ(""); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  if (!open) return null;
  const results = fuzzyFilter(items, q).slice(0, 8);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-20" onClick={onClose}>
      <div className="w-[420px] rounded-xl border border-border-strong bg-panel p-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a block or command…"
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && results[0]) { onPick(results[0]); onClose(); }
          }}
        />
        <div className="mt-1 max-h-72 overflow-y-auto">
          {results.length === 0 && <div className="px-3 py-2 text-xs text-text-3">No matches</div>}
          {results.map((r) => (
            <button
              key={r.id}
              onClick={() => { onPick(r); onClose(); }}
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm text-text-2 hover:bg-accent-soft hover:text-text-1 font-mono"
            >
              <span>{r.label}</span>
              {r.hint && <span className="text-text-3 text-xs">{r.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
