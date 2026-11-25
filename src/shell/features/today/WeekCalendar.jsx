import { useMemo, useState } from "react";
import { buildWeekCalendar } from "./weekCalendar.js";

const passMark = (fp) => fp.complete ? "✓" : fp.covered > 0 ? "◐" : "○";
const passText = (fp) => !fp.total ? "No objectives yet" : fp.complete ? "First pass complete" : `${fp.covered}/${fp.total} objectives covered`;

const shortDay = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" }); };

function LectureChip({ row, onStudy, review = false }) {
  const label = `${row.type}${row.number != null ? ` ${row.number}` : ""}`;
  return <li>
    <button type="button" onClick={() => onStudy?.(row.id)} title={`${row.title} · ${passText(row.firstPass)}`}
      className="flex w-full items-start gap-1.5 rounded border border-border px-2 py-1 text-left text-xs hover:border-border-strong">
      <span aria-hidden="true" className="font-mono">{review ? "↻" : passMark(row.firstPass)}</span>
      <span className="min-w-0"><span className="font-semibold">{label}</span> <span className="line-clamp-2 text-text-2">{row.title}</span>
        {row.movedFrom && <span className="block text-[11px] text-text-3">moved from {shortDay(row.movedFrom)} to even out the load</span>}
        <span className="sr-only"> · {review ? "review due" : passText(row.firstPass)}</span></span>
    </button>
  </li>;
}

/** Week view of lectures on the day they were given, with exam-aware reviews due each day. */
export function WeekCalendar({ lecScores = [], completion = {}, blockId, examDate, objectivesFor, evidence, onStudy, now: nowProp = null }) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  const [offset, setOffset] = useState(0);
  const cal = useMemo(() => buildWeekCalendar({ lecScores, completion, blockId, now, weekOffset: offset, examDate, objectivesFor, evidence }),
    [lecScores, completion, blockId, now, offset, examDate, objectivesFor, evidence]);
  const days = cal.days.filter((day) => !day.isWeekend || day.given.length || day.catchUp.length || day.reviews.length || day.isExam || day.isToday);
  const given = cal.days.reduce((n, day) => n + day.given.length, 0);
  const done = cal.days.reduce((n, day) => n + day.given.filter((row) => row.firstPass.complete).length, 0);

  return <section aria-label="Week calendar" className="rounded-xl border border-border bg-bg-elevated p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold">Week of {cal.label}</h3>
        <p className="text-xs text-text-3">{given ? `${done}/${given} lectures through first pass` : "No lectures dated this week"} · ✓ first pass done · ◐ in progress · ○ not started · ↻ review due</p>
        <p className="text-xs text-text-2">Daily limit {cal.cap} (review = 1, first pass = 2) so the work fits before the exam{cal.behind ? ` · ⚠ ${cal.behind} first pass${cal.behind === 1 ? "" : "es"} behind, scheduled as catch-up` : ""}</p></div>
      <div className="flex items-center gap-1 text-sm">
        <button type="button" aria-label="Previous week" onClick={() => setOffset((v) => v - 1)} className="rounded border border-border px-2 py-0.5">‹</button>
        {offset !== 0 && <button type="button" onClick={() => setOffset(0)} className="rounded border border-border px-2 py-0.5 text-xs">This week</button>}
        <button type="button" aria-label="Next week" onClick={() => setOffset((v) => v + 1)} className="rounded border border-border px-2 py-0.5">›</button>
      </div>
    </div>
    <ol className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(9.5rem, 1fr))` }}>
      {days.map((day) => {
        const next = day.catchUp[0] || day.given.find((row) => !row.firstPass.complete) || day.reviews[0] || day.given[0];
        return <li key={day.key} aria-current={day.isToday ? "date" : undefined}
          className={`flex flex-col gap-1.5 rounded-lg border p-2 ${day.isToday ? "border-accent border-2" : "border-border"} ${day.isPast && !day.isToday ? "opacity-80" : ""}`}>
          <div className="flex items-baseline justify-between gap-1 text-xs">
            <span className="font-semibold">{day.isToday ? "● Today" : day.date.toLocaleDateString("en-US", { weekday: "short" })} <span className="font-normal text-text-3">{day.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></span>
            {day.isExam && <span className="font-semibold">🎯 Exam</span>}
          </div>
          {day.load && day.load.lectures > 0 && <p className="text-[11px] text-text-3">{day.load.lectures} lecture{day.load.lectures === 1 ? "" : "s"} · load {day.load.units}/{cal.cap}{day.load.over ? " · ⚠ over limit" : ""}</p>}
          {day.given.length > 0 && <ul className="flex flex-col gap-1">{day.given.map((row) => <LectureChip key={row.id} row={row} onStudy={onStudy} />)}</ul>}
          {day.catchUp.length > 0 && <>
            <p className="mt-1 text-[11px] font-semibold text-text-3">Catch up (first pass)</p>
            <ul className="flex flex-col gap-1">{day.catchUp.map((row) => <LectureChip key={row.id} row={row} onStudy={onStudy} />)}</ul>
          </>}
          {day.reviews.length > 0 && <>
            <p className="mt-1 text-[11px] font-semibold text-text-3">Review</p>
            <ul className="flex flex-col gap-1">{day.reviews.map((row) => <LectureChip key={row.id} row={row} onStudy={onStudy} review />)}</ul>
          </>}
          {!day.given.length && !day.catchUp.length && !day.reviews.length && <p className="text-xs text-text-3">{day.isExam ? "Exam day" : "Nothing scheduled"}</p>}
          {next && onStudy && <button type="button" onClick={() => onStudy(next.id)} className="mt-auto rounded bg-accent px-2 py-1 text-xs font-semibold text-white">▸ Go through {day.isToday ? "today" : day.date.toLocaleDateString("en-US", { weekday: "short" })}</button>}
        </li>;
      })}
    </ol>
  </section>;
}
