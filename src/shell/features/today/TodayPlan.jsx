import { queueItemDone } from "./weekCalendar.js";
const label = (row) => `${row.type}${row.number != null ? ` ${row.number}` : ""}`;
const shortTitle = (row) => String(row.title || "").replace(/^(NB\s+)?(DLA\s+)?\d+\s*[-–:]?\s*/i, "") || row.title;

/**
 * Today's planned lectures (the calendar's today column) as one queue: first
 * passes, then reviews as 10-question quizzes on weak objectives. Start /
 * Continue opens the first item not done yet; come back here for the next one.
 */
export function TodayPlan({ queue = [], cap, unscheduled = [], doneIds, onStudy, onReview, onSkim, busy = null }) {
  // A first pass finished earlier today counts as done even without a check.
  const isDone = (item) => queueItemDone(item, doneIds);
  const done = queue.filter(isDone).length;
  const next = queue.find((item) => !isDone(item));
  const run = (item) => item.kind === "review" ? onReview(item.row) : onStudy(item.row.id);

  return <div className="flex flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-semibold text-text-1">{queue.length ? `${done} of ${queue.length} done today` : "Nothing planned today"}</p>
        <p className="text-xs text-text-3">Up to {cap} lectures a day · first passes, then reviews as 10-question quizzes on your weakest objectives</p>
      </div>
      {next && <button type="button" disabled={busy === next.row.id} onClick={() => run(next)}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        ▸ {done ? "Continue" : "Start today"}: {label(next.row)} {next.kind === "review" ? "review" : "first pass"}
      </button>}
      {!next && queue.length > 0 && <p className="text-sm font-semibold">✓ Today&apos;s plan is done</p>}
    </div>
    {queue.length > 0 && <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {queue.map((item, index) => {
        const finished = isDone(item);
        const acc = item.row.strength?.accuracy;
        return <li key={`${item.row.id}-${item.kind}`} className={`flex items-center gap-2 px-3 py-2 text-sm ${finished ? "opacity-60" : ""}`}>
          <span aria-hidden="true" className="w-4 font-mono">{finished ? "✓" : item.kind === "review" ? "↻" : "○"}</span>
          <span className="w-5 shrink-0 text-xs text-text-3">{index + 1}</span>
          <span className="shrink-0 font-semibold">{label(item.row)}</span>
          <span className="min-w-0 flex-1 truncate text-text-2" title={item.row.title}>{shortTitle(item.row)}</span>
          <span className="shrink-0 text-xs text-text-3">{item.kind === "review" ? `review${acc != null ? ` · ${Math.round(acc * 100)}%` : ""}` : "first pass"}{finished ? " · done" : ""}</span>
          <button type="button" disabled={busy === item.row.id} onClick={() => run(item)} className="shrink-0 rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50">
            {item.kind === "review" ? "Quiz 10" : "Study"}
          </button>
        </li>;
      })}
    </ol>}
    {unscheduled.length > 0 && <div className="rounded-lg border border-border p-3 text-sm">
      <p className="font-semibold">⚠ {unscheduled.length} first pass{unscheduled.length === 1 ? "" : "es"} won&apos;t fit before the exam</p>
      <p className="text-xs text-text-3">Skim instead: read the lecture&apos;s objectives, then answer 5 recall questions (about 15 minutes).</p>
      <ul className="mt-2 flex flex-wrap gap-2">{unscheduled.map((row) => <li key={row.id}>
        <button type="button" disabled={busy === row.id} onClick={() => onSkim(row)} className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50">Skim {label(row)}</button>
      </li>)}</ul>
    </div>}
  </div>;
}
