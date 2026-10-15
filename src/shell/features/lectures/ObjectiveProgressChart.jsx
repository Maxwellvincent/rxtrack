import { useState } from "react";

export function ObjectiveProgressChart({ rows = [] }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState(null);
  const accuracy = row => row.attempts ? Math.round(100 * row.correct / row.attempts) : null;
  const filtered = rows.filter(row => filter === "all" || (filter === "weak" ? row.state === "struggling" : filter === "untested" ? !row.attempts : row.ready))
    .sort((a, b) => Number(b.state === "struggling") - Number(a.state === "struggling") || Number(a.ready) - Number(b.ready) || (accuracy(a) ?? 101) - (accuracy(b) ?? 101));
  const pages = Math.max(1, Math.ceil(filtered.length / 6));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * 6, current * 6 + 6);
  const selected = visible.find(row => row.id === selectedId) || visible[0];
  return <div className="mt-4">
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter objective progress">
      {[["all", "All objectives"], ["weak", "Struggling"], ["untested", "Untested"], ["ready", "Ready"]].map(([id, label]) =>
        <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }} className={`rounded-full border px-3 py-2 text-xs ${filter === id ? "border-accent bg-accent-soft text-accent-text" : "border-border text-text-2"}`}>{label}</button>)}
    </div>
    <p className="mb-3 text-xs text-text-3">Bar height shows accuracy on distinct questions. Select a bar for details; dashed columns are untested. Readiness also requires varied, verified practice across sessions.</p>
    {!filtered.length && <p className="py-5 text-text-2">No objectives in this group yet.</p>}
    {!!visible.length && <div className="overflow-x-auto rounded-xl border border-border p-3 sm:p-4">
      <div className="relative pl-10" style={{ minWidth: Math.max(300, visible.length * 80 + 40) }}>
        <div aria-hidden="true" className="pointer-events-none absolute left-0 right-0" style={{ top: 28, height: 180 }}>
          {[100, 75, 50, 25, 0].map(value => <div key={value} className="absolute left-0 right-0 flex items-center" style={{ top: `${100 - value}%`, transform: "translateY(-50%)" }}>
            <span className="w-9 shrink-0 pr-2 text-right text-xs text-text-3">{value}{value === 100 ? "%" : ""}</span>
            <span className="flex-1 border-t border-border" />
          </div>)}
        </div>
        <div className="relative grid gap-3" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(64px, 1fr))` }} aria-label="Objective accuracy chart">
          {visible.map(row => {
            const percent = accuracy(row);
            const active = selected?.id === row.id;
            const label = `Objective ${rows.findIndex(item => item.id === row.id) + 1}`;
            return <button key={row.id} type="button" aria-pressed={active}
              aria-label={`${label}: ${row.text || row.code}. ${percent === null ? "Untested" : `${percent}% correct, ${row.correct} of ${row.attempts} questions`}. ${row.ready ? "Ready" : !row.attempts ? "Untested" : row.state === "struggling" ? "Struggling" : "Developing"}`}
              title={row.text || row.code} onClick={() => setSelectedId(row.id)}
              className={`min-w-0 rounded-lg px-1 pb-2 text-center focus-visible:outline-2 focus-visible:outline-accent ${active ? "ring-1 ring-accent" : "hover:bg-bg-2"}`}>
              <span className="block text-sm font-semibold text-text-1" style={{ height: 28 }}>{percent === null ? "—" : `${percent}%`}</span>
              <span className="relative mx-auto flex items-end justify-center" style={{ height: 180, maxWidth: 64 }}>
                <span className={`block w-full rounded-t-md ${percent === null ? "border border-dashed border-border bg-bg-2" : row.ready ? "bg-good" : row.state === "struggling" ? "bg-bad" : "bg-accent"}`}
                  style={{ height: percent === null ? "100%" : `${percent}%`, minHeight: percent === 0 ? 3 : undefined, opacity: percent === null ? 0.35 : 1 }} />
              </span>
              <span className={`mt-3 block text-xs font-medium ${active ? "text-accent-text" : "text-text-2"}`}>{label}</span>
              <span className="mt-1 block text-xs text-text-3">{row.attempts} Qs</span>
            </button>;
          })}
        </div>
      </div>
    </div>}
    {selected && <article className="mt-3 rounded-xl border border-border p-3 sm:p-4" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium leading-snug text-text-1">{selected.text || selected.code}</h4>
        <span className={`shrink-0 text-xs ${selected.ready ? "text-good" : selected.state === "struggling" ? "text-bad" : "text-text-2"}`}>{selected.ready ? "Ready" : !selected.attempts ? "Untested" : selected.state === "struggling" ? "Struggling" : "Developing"}</span>
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-text-2">
        <span>{selected.attempts} questions · {selected.correct} correct</span>
        <span>Next: {selected.targetOrder?.replace("-order", " order") || "Not established"}</span>
      </div>
      <details className="mt-2 text-xs text-text-3"><summary className="cursor-pointer">Practice details</summary>
        <p className="mt-2">{selected.code}</p>
        <p>{selected.missingRequirements?.join(" · ") || "Readiness floor met · spaced maintenance"}</p>
        <p>Verified level: {selected.demonstrated?.map(order => order.replace("-order", " order")).join(", ") || "Not established"}</p>
      </details>
    </article>}
    {pages > 1 && <div className="flex items-center justify-between gap-3 py-2">
      <button type="button" disabled={!current} onClick={() => setPage(current - 1)} className="px-3 py-2 disabled:opacity-40">← Previous</button>
      <span className="text-xs text-text-3">{current + 1} / {pages} · {filtered.length} objectives</span>
      <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} className="px-3 py-2 disabled:opacity-40">Next →</button>
    </div>}
  </div>;
}
