import { useCallback, useMemo, useState } from "react";
import { blockCoverage } from "./data.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { useObjectives } from "./hooks/useObjectives.js";
import { StatusGlyph } from "../ui/Badge.jsx";
import {
  readCollapsedTerms,
  writeCollapsedTerms,
  toggleTerm,
  collapseAllExcept,
  isTermVisible,
} from "./navPrefs.js";

export function Sidebar({ activeBlockId, onSelectBlock, onOpenPalette, userId = null }) {
  const blocks = useBlocks(userId);
  const objectives = useObjectives(null, userId);
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
    <aside className="shell-chrome flex w-56 flex-col border-r border-border bg-bg text-text-2">
      {/* Logo */}
      <div className="border-b border-border px-5 py-4">
        <div
          className="font-condensed text-xl font-bold uppercase tracking-wider"
          style={{ color: "var(--text-1)" }}
        >
          Rx<span style={{ color: "var(--accent)" }}>Track</span>
        </div>
        <div className="mt-0.5 font-mono text-[13px] uppercase tracking-widest text-text-3">
          Study Dashboard
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2.5">
        <button
          onClick={onOpenPalette}
          className="flex w-full items-center justify-between rounded-sm border border-border bg-panel px-3 py-1.5 text-text-3 transition-colors hover:border-border-strong hover:text-text-2"
        >
          <span className="font-mono text-[12px]">Search…</span>
          <span className="font-mono text-[12px]">⌘K</span>
        </button>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto">
        {byTerm.length === 0 && (
          <div className="px-5 py-6 font-mono text-[12px] text-text-3">No terms yet.</div>
        )}
        {byTerm.map((term) => {
          const open = isTermVisible(term, { collapsed, activeBlockId });
          const hasActive = term.blocks.some((b) => b.id === activeBlockId);
          return (
            <div key={term.id}>
              <button
                onClick={() => persist(toggleTerm(collapsed, term.id))}
                title={collapsed.has(term.id) ? "Expand term" : "Collapse term"}
                className="flex w-full items-center justify-between px-5 pb-1 pt-3 font-condensed text-[12px] font-bold uppercase tracking-widest text-text-3 hover:text-text-2"
              >
                <span className="flex items-center gap-1.5 truncate">
                  <span className={"transition-transform " + (open ? "" : "-rotate-90")}>▾</span>
                  {term.name}
                </span>
                <span className="font-mono text-[13px] opacity-60">
                  {open ? term.blocks.length : `${term.blocks.length} hidden`}
                </span>
              </button>

              {open &&
                term.blocks.map((b) => {
                  const cov = blockCoverage(objectives.data, b.id);
                  const active = b.id === activeBlockId;
                  return (
                    <button
                      key={b.id}
                      onClick={() => onSelectBlock(b.id)}
                      className={[
                        "flex w-full items-center justify-between border-l-[3px] px-4 py-2 text-left text-xs transition-colors",
                        active
                          ? "border-accent bg-accent-soft text-text-1"
                          : "border-transparent text-text-2 hover:bg-bg-elevated hover:text-text-1",
                      ].join(" ")}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <StatusGlyph status={b.status} />
                        <span className="truncate">{b.name}</span>
                      </span>
                      {cov != null && (
                        <span className={[
                          "ml-2 flex-shrink-0 font-mono text-[12px]",
                          active ? "font-bold text-accent-text" : "text-text-3",
                        ].join(" ")}>
                          {cov}%
                        </span>
                      )}
                    </button>
                  );
                })}

              {!open && hasActive && (
                <div className="px-5 pb-1 font-mono text-[13px] text-text-3">(showing current)</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border px-5 py-3 font-mono text-[13px] text-text-3">
        <span>{blocks.length} blocks</span>
        {byTerm.length > 1 && activeTermId && (
          <button
            onClick={() => persist(othersCollapsed ? new Set() : collapseAllExcept(byTerm, activeTermId))}
            className="uppercase tracking-wider hover:text-text-2"
          >
            {othersCollapsed ? "show all" : "this term"}
          </button>
        )}
      </div>
    </aside>
  );
}
