import { useCallback, useMemo, useState } from "react";
import { blockCoverage } from "./data.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { StatusGlyph } from "../ui/Badge.jsx";
import {
  readCollapsedTerms,
  writeCollapsedTerms,
  toggleTerm,
  collapseAllExcept,
  isTermVisible,
} from "./navPrefs.js";

export function Sidebar({ activeBlockId, onSelectBlock, onOpenPalette, userId = null }) {
  // Reactive: a schedule import or lecture upload updates the nav without a reload.
  const blocks = useBlocks(userId);
  const [collapsed, setCollapsed] = useState(() => readCollapsedTerms());

  const byTerm = useMemo(() => {
    const m = new Map();
    for (const b of blocks) {
      if (!m.has(b.termId)) m.set(b.termId, { id: b.termId, name: b.termName, blocks: [] });
      m.get(b.termId).blocks.push(b);
    }
    return [...m.values()];
  }, [blocks]);

  const persist = useCallback((next) => {
    setCollapsed(next);
    writeCollapsedTerms(next);
  }, []);

  const activeTermId = useMemo(
    () => byTerm.find((t) => t.blocks.some((b) => b.id === activeBlockId))?.id ?? null,
    [byTerm, activeBlockId]
  );

  const othersCollapsed =
    activeTermId != null && byTerm.every((t) => t.id === activeTermId || collapsed.has(t.id));

  return (
    <aside className="flex w-60 flex-col border-r border-border bg-bg-elevated text-text-2">
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
        {byTerm.map((term) => {
          const open = isTermVisible(term, { collapsed, activeBlockId });
          const hasActive = term.blocks.some((b) => b.id === activeBlockId);
          return (
            <div key={term.id}>
              <button
                onClick={() => persist(toggleTerm(collapsed, term.id))}
                title={collapsed.has(term.id) ? "Expand term" : "Collapse term"}
                className="flex w-full items-center justify-between px-3.5 pt-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-text-3 hover:text-text-1"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span className={"transition-transform " + (open ? "" : "-rotate-90")}>▾</span>
                  {term.name}
                </span>
                <span className="font-mono opacity-70">
                  {open ? term.blocks.length : `${term.blocks.length} hidden`}
                </span>
              </button>

              {open &&
                term.blocks.map((b) => {
                  const cov = blockCoverage(b.id);
                  const active = b.id === activeBlockId;
                  return (
                    <button
                      key={b.id}
                      onClick={() => onSelectBlock(b.id)}
                      className={
                        "flex w-full items-center justify-between px-3.5 py-1.5 text-xs " +
                        (active
                          ? "bg-accent-soft text-text-1 border-l-2 border-accent"
                          : "text-text-2 hover:bg-panel border-l-2 border-transparent")
                      }
                    >
                      <span className="flex items-center gap-2 truncate">
                        <StatusGlyph status={b.status} />
                        {b.name}
                      </span>
                      {cov != null && (
                        <span className={active ? "text-accent-text font-bold" : "opacity-60"}>{cov}%</span>
                      )}
                    </button>
                  );
                })}

              {/* A collapsed term still shows the block you are on — hiding it
                  would make the nav disagree with the pane next to it. */}
              {!open && hasActive && (
                <div className="px-3.5 pb-1 font-mono text-[10px] text-text-3">(showing current block)</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3.5 py-2.5 text-[10px] text-text-3 font-mono">
        <span>{blocks.length} blocks</span>
        {byTerm.length > 1 && activeTermId && (
          <button
            onClick={() => persist(othersCollapsed ? new Set() : collapseAllExcept(byTerm, activeTermId))}
            className="hover:text-text-1"
            title={othersCollapsed ? "Show every term" : "Collapse every other term"}
          >
            {othersCollapsed ? "show all" : "this term only"}
          </button>
        )}
      </div>
    </aside>
  );
}
