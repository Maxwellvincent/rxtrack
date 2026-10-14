import { useState } from "react";

export function ObjectiveProgressChart({ rows = [] }) {
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const accuracy = row => row.attempts ? Math.round(100 * row.correct / row.attempts) : null;
  const filtered = rows.filter(row => filter === "all" || (filter === "weak" ? row.state === "struggling" : filter === "untested" ? !row.attempts : row.ready))
    .sort((a, b) => Number(b.state === "struggling") - Number(a.state === "struggling") || Number(a.ready) - Number(b.ready) || (accuracy(a) ?? 101) - (accuracy(b) ?? 101));
  const pages = Math.max(1, Math.ceil(filtered.length / 6));
  const current = Math.min(page, pages - 1);
  return <div className="mt-4">
    <div className="mb-4 flex flex-wrap gap-2" aria-label="Filter objective progress">
      {[["all", "All objectives"], ["weak", "Struggling"], ["untested", "Untested"], ["ready", "Ready"]].map(([id, label]) =>
        <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(0); }} className={`rounded-full border px-3 py-2 text-xs ${filter === id ? "border-accent bg-accent-soft text-accent-text" : "border-border text-text-2"}`}>{label}</button>)}
    </div>
    <p className="mb-3 text-xs text-text-3">Bars show accuracy on distinct questions. Readiness also requires varied, verified practice across sessions.</p>
    {!filtered.length && <p className="py-5 text-text-2">No objectives in this group yet.</p>}
    {filtered.slice(current * 6, current * 6 + 6).map(row => {
      const percent = accuracy(row);
      return <article key={row.id} className="mb-3 rounded-xl border border-border p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="text-sm font-medium leading-snug text-text-1">{row.text || row.code}</h4>
          <span className={`shrink-0 text-xs ${row.ready ? "text-good" : row.state === "struggling" ? "text-bad" : "text-text-2"}`}>{row.ready ? "Ready" : !row.attempts ? "Untested" : row.state === "struggling" ? "Struggling" : "Developing"}</span>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div role="img" aria-label={percent === null ? "Not yet tested" : `${percent}% correct, ${row.correct} of ${row.attempts} questions`} className="flex h-3 flex-1 overflow-hidden rounded-full bg-border">
            {percent !== null && <><div className="h-full bg-good" style={{ width: `${percent}%` }} /><div className="h-full bg-bad/60" style={{ width: `${100 - percent}%` }} /></>}
          </div>
          <span className="w-12 text-right text-sm font-semibold">{percent === null ? "—" : `${percent}%`}</span>
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-text-2">
          <span>{row.attempts} questions · {row.correct} correct</span>
          <span>Next: {row.targetOrder?.replace("-order", " order") || "Not established"}</span>
        </div>
        <details className="mt-2 text-xs text-text-3"><summary className="cursor-pointer">Practice details</summary>
          <p className="mt-2">{row.code}</p>
          <p>{row.missingRequirements?.join(" · ") || "Readiness floor met · spaced maintenance"}</p>
          <p>Verified level: {row.demonstrated?.map(order => order.replace("-order", " order")).join(", ") || "Not established"}</p>
        </details>
      </article>;
    })}
    {pages > 1 && <div className="flex items-center justify-between gap-3 py-2">
      <button type="button" disabled={!current} onClick={() => setPage(current - 1)} className="px-3 py-2 disabled:opacity-40">← Previous</button>
      <span className="text-xs text-text-3">{current + 1} / {pages} · {filtered.length} objectives</span>
      <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)} className="px-3 py-2 disabled:opacity-40">Next →</button>
    </div>}
  </div>;
}
