import { useCallback, useMemo, useState } from "react";
import { blockCoverage } from "./data.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { useObjectives } from "./hooks/useObjectives.js";
import * as termsStore from "../stores/terms.js";
import { StatusGlyph } from "../ui/Badge.jsx";
import {
  readCollapsedTerms,
  writeCollapsedTerms,
  toggleTerm,
  collapseAllExcept,
  isTermVisible,
} from "./navPrefs.js";

const RAIL_KEY = "rxt-sidebar-collapsed";
function readRail() {
  try {
    const saved = localStorage.getItem(RAIL_KEY);
    return saved == null ? !!window.matchMedia?.("(max-width: 760px)").matches : saved === "1";
  } catch { return false; }
}
function writeRail(v) { localStorage.setItem(RAIL_KEY, v ? "1" : "0"); }

export function Sidebar({ activeBlockId, onSelectBlock, onOpenPalette, userId = null }) {
  const blocks = useBlocks(userId);
  const objectives = useObjectives(null, userId);
  const [collapsed, setCollapsed] = useState(() => readCollapsedTerms());
  const [rail, setRail] = useState(() => readRail());
  const [organizeTerm, setOrganizeTerm] = useState(null);
  const [groupTitle, setGroupTitle] = useState("Neuro & Behavior");
  const [childNames, setChildNames] = useState(["NB 1", "NB 2", "NB 3"]);
  const [savingGroup, setSavingGroup] = useState(false);
  const [groupError, setGroupError] = useState("");

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

  const toggleRail = useCallback(() => {
    setRail((r) => { writeRail(!r); return !r; });
  }, []);

  const activeTermId = useMemo(
    () => byTerm.find((t) => t.blocks.some((b) => b.id === activeBlockId))?.id ?? null,
    [byTerm, activeBlockId]
  );

  const othersCollapsed =
    activeTermId != null && byTerm.every((t) => t.id === activeTermId || collapsed.has(t.id));

  /* ── Collapsed rail — narrow icon strip ─────────────────────────────── */
  if (rail) {
    return (
      <aside aria-label="Blocks" className="desk-sidebar-rail shell-chrome flex w-12 flex-col border-r border-border bg-bg">
        {/* Expand toggle */}
        <button
          onClick={toggleRail}
          title="Expand sidebar"
          className="flex h-12 w-full items-center justify-center border-b border-border text-text-3 hover:text-text-1 transition-colors"
        >
          <span className="text-base">›</span>
        </button>

        {/* Block dots — one per block, accent-colored if active */}
        <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
          {blocks.map((b) => {
            const active = b.id === activeBlockId;
            return (
              <button
                key={b.id}
                onClick={() => onSelectBlock(b.id)}
                title={b.name}
                aria-label={b.name}
                aria-current={active ? "true" : undefined}
                className="flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-bg-elevated"
              >
                <span aria-hidden="true"
                  className={active ? "h-3 w-3 rounded-sm outline outline-2 outline-offset-2 outline-accent" : "h-2.5 w-2.5 rounded-full transition-colors"}
                  style={{
                    background: active ? "var(--accent)" : "var(--border-strong)",
                  }}
                />
              </button>
            );
          })}
        </div>

        {/* Search icon */}
        <button
          onClick={onOpenPalette}
          title="Search (⌘K)"
          className="flex h-10 w-full items-center justify-center border-t border-border text-text-3 hover:text-text-1 transition-colors"
        >
          <span className="text-sm">⌘</span>
        </button>
      </aside>
    );
  }

  /* ── Full sidebar ────────────────────────────────────────────────────── */
  return (
    <aside aria-label="Blocks" className="desk-sidebar shell-chrome flex w-56 flex-col border-r border-border bg-bg text-text-2">
      {/* Logo + collapse toggle */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <div
            className="font-condensed text-xl font-bold uppercase tracking-wider"
            style={{ color: "var(--text-1)" }}
          >
            Rx<span style={{ color: "var(--accent)" }}>Track</span>
          </div>
          <div className="mt-0.5 font-mono text-[13px] uppercase tracking-widest text-text-3">
            Your study desk
          </div>
        </div>
        <button
          onClick={toggleRail}
          title="Collapse sidebar"
          className="ml-2 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-text-3 hover:bg-bg-elevated hover:text-text-1 transition-colors"
        >
          ‹
        </button>
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

              {open && (() => {
                const groups = [];
                const grouped = new Map();
                for (const b of term.blocks) {
                  if (!b.groupTitle) { groups.push({ key: b.id, blocks: [b] }); continue; }
                  if (!grouped.has(b.groupTitle)) {
                    const group = { key: `group:${b.groupTitle}`, title: b.groupTitle, blocks: [] };
                    grouped.set(b.groupTitle, group);
                    groups.push(group);
                  }
                  grouped.get(b.groupTitle).blocks.push(b);
                }
                return groups.map((group) => <div key={group.key}>
                  {group.title && <div className="px-5 pb-1 pt-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-text-3">{group.title}</div>}
                  {group.blocks.map((b) => {
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
                </div>);
              })()}

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
      {byTerm.length > 0 && <button type="button" onClick={() => {
        const active = blocks.find((b) => b.id === activeBlockId);
        const term = byTerm.find((t) => t.id === active?.termId) || byTerm[0];
        if (!term) return;
        setOrganizeTerm(term);
        setGroupTitle("Neuro & Behavior");
        setChildNames(["NB 1", "NB 2", "NB 3"]);
        setGroupError("");
      }} className="border-t border-border px-5 py-2 text-left text-xs text-text-3 hover:bg-bg-elevated hover:text-text-1">＋ Set up sub-blocks</button>}
      {organizeTerm && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !savingGroup) setOrganizeTerm(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="subblock-title" className="w-full max-w-lg rounded-lg border border-border bg-panel p-5 shadow-xl">
          <h2 id="subblock-title" className="text-lg font-semibold text-text-1">Set up sub-blocks</h2>
          <p className="mt-1 text-sm text-text-3">The selected existing block keeps its ID and study data; two new empty blocks are added.</p>
          <label className="mt-4 block text-xs text-text-2">Main title<input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text-1" /></label>
          <div className="mt-3 grid grid-cols-1 gap-2">{childNames.map((name, i) => <label key={i} className="text-xs text-text-2">Sub-block {i + 1}<input value={name} onChange={(e) => setChildNames((old) => old.map((v, j) => j === i ? e.target.value : v))} className="mt-1 w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text-1" /></label>)}</div>
          {groupError && <p role="alert" className="mt-3 text-sm text-bad">{groupError}</p>}
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={savingGroup} onClick={() => setOrganizeTerm(null)} className="rounded border border-border px-3 py-2 text-sm">Cancel</button><button type="button" disabled={savingGroup} onClick={async () => {
            const names = childNames.map((n) => n.trim());
            if (!groupTitle.trim() || names.some((n) => !n)) { setGroupError("Enter a main title and all three sub-block names."); return; }
            const current = blocks.find((b) => b.id === activeBlockId && b.termId === organizeTerm.id);
            if (!current) { setGroupError("Select a block in this term first so its study data can be retained as the first sub-block."); return; }
            setSavingGroup(true); setGroupError("");
            try {
              const terms = termsStore.read(userId) || [];
              const next = terms.map((t) => {
                if (t.id !== organizeTerm.id) return t;
                let matched = false;
                const updated = (t.blocks || []).map((b) => {
                  if (b.id === current.id) { matched = true; return { ...b, name: names[0], groupTitle: groupTitle.trim() }; }
                  return b;
                });
                if (!matched) throw new Error("The selected block changed. Reopen setup and try again.");
                const existingSiblings = updated.filter((b) => b.id !== current.id && b.groupTitle === groupTitle.trim());
                for (const [index, name] of names.slice(1).entries()) {
                  const sibling = existingSiblings[index];
                  if (sibling) {
                    const siblingIndex = updated.findIndex((b) => b.id === sibling.id);
                    updated[siblingIndex] = { ...sibling, name };
                  } else updated.push({ id: crypto.randomUUID(), name, groupTitle: groupTitle.trim(), status: "active" });
                }
                return { ...t, blocks: updated };
              });
              await termsStore.write(userId, next);
              setOrganizeTerm(null);
            } catch (error) { setGroupError(error?.message || "Could not save sub-blocks."); }
            finally { setSavingGroup(false); }
          }} className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">{savingGroup ? "Saving…" : "Save sub-blocks"}</button></div>
        </section>
      </div>}
    </aside>
  );
}
