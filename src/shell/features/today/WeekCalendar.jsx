import { useMemo, useState } from "react";
import { buildWeekCalendar, dayQueue, queueItemDone, DAILY_LIMIT } from "./weekCalendar.js";

const passMark = (fp) => fp.complete ? "✓" : fp.covered > 0 ? "◐" : "○";
const passText = (fp) => !fp.total ? "No objectives yet" : fp.complete ? "First pass complete" : `${fp.covered}/${fp.total} objectives covered`;
const shortDay = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" }); };
// "NB 58 Trauma- and Stressor-…" → "Trauma- and Stressor-…": the code is already in the label.
const shortTitle = (row) => String(row.title || "").replace(/^(NB\s+)?(DLA\s+)?\d+\s*[-–:]?\s*/i, "") || row.title;

function LectureRow({ row, onStudy, onReview, review = false, done = false }) {
  const label = `${row.type}${row.number != null ? ` ${row.number}` : ""}`;
  const meta = [
    review && row.strength?.accuracy != null ? `${Math.round(row.strength.accuracy * 100)}%${row.strength.struggling ? " ⚠" : ""}` : null,
    row.movedFrom ? `from ${shortDay(row.movedFrom)}` : null,
  ].filter(Boolean).join(" · ");
  return <li>
    <button type="button" onClick={() => review && onReview ? onReview(row) : onStudy?.(row.id)}
      title={`${row.title} · ${review ? "review" : passText(row.firstPass)}${row.strength?.accuracy != null ? ` · ${Math.round(row.strength.accuracy * 100)}% correct` : ""}${row.movedFrom ? ` · moved from ${shortDay(row.movedFrom)} to keep the day under the limit` : ""}`}
      className="flex w-full items-baseline gap-1.5 rounded px-1.5 py-1 text-left text-xs hover:bg-bg">
      <span aria-hidden="true" className="w-3 shrink-0 font-mono">{done ? "✓" : review ? "↻" : passMark(row.firstPass)}</span>
      <span className={`shrink-0 font-semibold ${done ? "text-text-3 line-through" : ""}`}>{label}</span>
      <span className="min-w-0 flex-1 truncate text-text-2">{shortTitle(row)}</span>
      {meta && <span className="shrink-0 text-[11px] text-text-3">{meta}</span>}
      <span className="sr-only"> · {review ? "review" : passText(row.firstPass)}{done ? " · done today" : ""}</span>
    </button>
  </li>;
}

function Group({ title, rows, onStudy, onReview, review = false, isDone = null }) {
  if (!rows.length) return null;
  return <div>
    {title && <p className="px-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wide text-text-3">{title}</p>}
    <ul>{rows.map((row) => <LectureRow key={`${row.id}-${review}`} row={row} onStudy={onStudy} onReview={onReview} review={review} done={isDone ? isDone(row, review) : false} />)}</ul>
  </div>;
}

/** Week view: lectures on the day they were given, then a planned day (≤ limit) from today to the exam. */
export function WeekCalendar({ lecScores = [], completion = {}, blockId, examDate, objectivesFor, evidence, onStudy, onReview = null, limit = DAILY_LIMIT, onLimitChange = null, now: nowProp = null, todayQueue = null, doneIds = null }) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  const [offset, setOffset] = useState(0);
  const cal = useMemo(() => buildWeekCalendar({ lecScores, completion, blockId, now, weekOffset: offset, examDate, objectivesFor, evidence, limit }),
    [lecScores, completion, blockId, now, offset, examDate, objectivesFor, evidence, limit]);
  const days = cal.days.filter((day) => !day.isWeekend || day.given.length || day.catchUp.length || day.reviews.length || day.isExam || day.isToday);
  const status = [
    cal.behind ? `⚠ ${cal.behind} first pass${cal.behind === 1 ? "" : "es"} behind` : null,
    cal.secure ? `✓ ${cal.secure} at 80%+ skip review` : null,
    cal.skipped ? `${cal.skipped} low-priority review${cal.skipped === 1 ? "" : "s"} dropped` : null,
  ].filter(Boolean);

  return <section aria-label="Week calendar" className="rounded-xl border border-border bg-bg-elevated p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Week of {cal.label} <span className="font-normal text-text-3">· up to {onLimitChange
          ? <select aria-label="Lectures per day" value={limit} onChange={(e) => onLimitChange(Number(e.target.value))} className="rounded border border-border bg-bg px-1 text-xs">{[4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          : cal.cap} lectures a day</span></h3>
        {status.length > 0 && <p className="text-xs text-text-2">{status.join(" · ")}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-sm">
        <button type="button" aria-label="Previous week" onClick={() => setOffset((v) => v - 1)} className="rounded border border-border px-2 py-0.5">‹</button>
        {offset !== 0 && <button type="button" onClick={() => setOffset(0)} className="rounded border border-border px-2 py-0.5 text-xs">This week</button>}
        <button type="button" aria-label="Next week" onClick={() => setOffset((v) => v + 1)} className="rounded border border-border px-2 py-0.5">›</button>
      </div>
    </div>
    {cal.unscheduled.length > 0 && <p className="mt-1 text-xs">⚠ No room before the exam for: {cal.unscheduled.map((row) => `${row.type} ${row.number ?? ""}`.trim()).join(", ")}. Skim them from Today&apos;s plan, or raise the daily limit.</p>}
    <ol className="mt-2 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(12rem, 1fr))" }}>
      {days.map((day) => {
        // Today follows the plan frozen this morning, so finished items stay listed with ✓
        // and the count reads done/planned instead of dropping out as the plan recomputes.
        const plan = day.isToday && todayQueue?.length ? todayQueue : null;
        if (plan) {
          const givenIds = new Set(day.given.map((row) => row.id));
          const doneItem = (item) => queueItemDone(item, doneIds || new Set());
          const done = plan.filter(doneItem).length;
          const next = plan.find((item) => !doneItem(item));
          const firsts = plan.filter((item) => item.kind !== "review");
          const isDone = (row, review) => plan.some((item) => item.row.id === row.id && (item.kind === "review") === review && doneItem(item));
          return <li key={day.key} aria-current="date" className="flex flex-col rounded-lg border-2 border-accent p-1.5">
            <div className="flex items-baseline justify-between gap-1 px-1.5 text-xs">
              <span className="font-semibold">● Today <span className="font-normal text-text-3">{day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>
              <span className={done === plan.length ? "font-semibold" : "text-text-3"} aria-label={`${done} of ${plan.length} done today`}>{done === plan.length ? "✓ " : ""}{done}/{plan.length} done</span>
            </div>
            <Group title={firsts.some((item) => givenIds.has(item.row.id)) ? "New" : null} rows={firsts.filter((item) => givenIds.has(item.row.id)).map((item) => item.row)} onStudy={onStudy} isDone={isDone} />
            <Group title="Catch up" rows={firsts.filter((item) => !givenIds.has(item.row.id)).map((item) => item.row)} onStudy={onStudy} isDone={isDone} />
            <Group title="Review" rows={plan.filter((item) => item.kind === "review").map((item) => item.row)} onStudy={onStudy} onReview={onReview} review isDone={isDone} />
            {next && onStudy
              ? <button type="button" onClick={() => next.kind === "review" && onReview ? onReview(next.row) : onStudy(next.row.id)} className="mt-auto rounded bg-accent px-2 py-1 text-xs font-semibold text-white">▸ {done ? "Continue" : "Start today"}</button>
              : <p className="mt-auto px-1.5 py-1 text-xs font-semibold">✓ Today&apos;s plan is done</p>}
          </li>;
        }
        const first = dayQueue(day)[0] || (day.given[0] ? { row: day.given[0], kind: "first" } : null);
        const count = day.load?.lectures ?? 0;
        return <li key={day.key} aria-current={day.isToday ? "date" : undefined}
          className={`flex flex-col rounded-lg border p-1.5 ${day.isToday ? "border-2 border-accent" : "border-border"} ${day.isPast && !day.isToday ? "opacity-75" : ""}`}>
          <div className="flex items-baseline justify-between gap-1 px-1.5 text-xs">
            <span className="font-semibold">{day.isToday ? "● Today" : day.date.toLocaleDateString("en-US", { weekday: "short" })} <span className="font-normal text-text-3">{day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>
            {day.isExam ? <span className="font-semibold">🎯 Exam</span> : day.load && count > 0 && <span className="text-text-3">{count}/{cal.cap}</span>}
          </div>
          <Group title={day.isPast ? null : day.given.length && (day.catchUp.length || day.reviews.length) ? "New" : null} rows={day.given} onStudy={onStudy} />
          <Group title="Catch up" rows={day.catchUp} onStudy={onStudy} />
          <Group title="Review" rows={day.reviews} onStudy={onStudy} onReview={onReview} review />
          {!day.given.length && !day.catchUp.length && !day.reviews.length && <p className="px-1.5 py-1 text-xs text-text-3">{day.isExam ? "Exam day" : "Nothing scheduled"}</p>}
          {first && onStudy && !day.isPast && <button type="button" onClick={() => first.kind === "review" && onReview ? onReview(first.row) : onStudy(first.row.id)} className="mt-auto rounded bg-accent px-2 py-1 text-xs font-semibold text-white">▸ Start {day.isToday ? "today" : shortDay(day.key)}</button>}
        </li>;
      })}
    </ol>
    <p className="mt-2 text-[11px] text-text-3">✓ done (today: done today) · ◐ in progress · ○ not started · ↻ review · % = your accuracy · hover a row for details</p>
  </section>;
}
