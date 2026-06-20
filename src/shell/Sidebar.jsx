import { useMemo } from "react";
import { readTerms, readLectures, flattenBlocks, blockCoverage } from "./data.js";
import { StatusGlyph } from "../ui/Badge.jsx";

export function Sidebar({ activeBlockId, onSelectBlock, onOpenPalette }) {
  const terms = useMemo(() => readTerms(), []);
  const lectures = useMemo(() => readLectures(), []);
  const blocks = useMemo(() => flattenBlocks(terms, lectures), [terms, lectures]);
  const byTerm = useMemo(() => {
    const m = new Map();
    for (const b of blocks) {
      if (!m.has(b.termId)) m.set(b.termId, { id: b.termId, name: b.termName, blocks: [] });
      m.get(b.termId).blocks.push(b);
    }
    return [...m.values()];
  }, [blocks]);

  return (
    <aside className="flex w-[210px] flex-col border-r border-border bg-bg-elevated text-text-2">
      <div className="p-2.5">
        <button
          onClick={onOpenPalette}
          className="flex w-full items-center justify-between rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-text-3 font-mono"
        >
          Search… <span>⌘K</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {byTerm.length === 0 && (
          <div className="px-3.5 py-6 text-xs text-text-3">No terms yet.</div>
        )}
        {byTerm.map((term) => (
          <div key={term.id}>
            <div className="px-3.5 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-text-3">{term.name}</div>
            {term.blocks.map((b) => {
              const cov = blockCoverage(b.id);
              const active = b.id === activeBlockId;
              return (
                <button
                  key={b.id}
                  onClick={() => onSelectBlock(b.id)}
                  className={
                    "flex w-full items-center justify-between px-3.5 py-1.5 text-xs " +
                    (active ? "bg-accent-soft text-text-1 border-l-2 border-accent" : "text-text-2 hover:bg-panel border-l-2 border-transparent")
                  }
                >
                  <span className="flex items-center gap-2 truncate">
                    <StatusGlyph status={b.status} />
                    {b.name}
                  </span>
                  {cov != null && <span className={active ? "text-accent-text font-bold" : "opacity-60"}>{cov}%</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-border px-3.5 py-2.5 text-[10px] text-text-3 font-mono">
        {blocks.length} blocks
      </div>
    </aside>
  );
}
