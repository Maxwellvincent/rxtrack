import { useEffect, useMemo, useState } from "react";
import { formatLectureLabel } from "../../../lectureTitle.js";
import { lectureReviewTiming, reviewDateLabel } from "./lectureReviewTiming.js";
const segments = [
 { key: "m", label: "Mastered", symbol: "✓", color: "#0072b2", pattern: "none" },
 { key: "ip", label: "Learning", symbol: "~", color: "#e69f00", pattern: "repeating-linear-gradient(0deg, transparent 0 6px, #17212b 6px 8px)" },
 { key: "st", label: "Needs review", symbol: "!", color: "#cc79a7", pattern: "repeating-linear-gradient(45deg, transparent 0 6px, #17212b 6px 8px)" },
 { key: "ut", label: "Not yet tested", symbol: "○", color: "#f3f4f6", pattern: "radial-gradient(#536171 1px, transparent 1px)", size: "6px 6px" },
];
const segmentStyle = segment => ({ backgroundColor: segment.color, backgroundImage: segment.pattern, backgroundSize: segment.size, borderTop: "1px solid #17212b" });
export function lectureReviewAccuracy(lecture, evidence = {}, getLecPerf, blockId) {
 const stats = evidence.lectures?.[lecture.id];
 if (stats?.recent?.length >= 3) return stats.recent.filter(Boolean).length / stats.recent.length;
 if (stats?.attempts > 0) return stats.correct / stats.attempts;
 const score = getLecPerf?.(lecture, blockId)?.lastScore;
 return typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(1, score / 100)) : null;
}
export function lectureReviewActivity(lecture, blockId, completion = {}, evidence = {}, getLecPerf) {
 const ids = [...new Set([lecture.id, ...(lecture.mergedFrom || []).map(row => row.id)])];
 const reviews = ids.flatMap(id => completion?.[`${id}__${blockId}`]?.activityLog || []).filter(row => row.activityType === "review");
 const manual = new Set(reviews.map(row => row.id || JSON.stringify(row))).size;
 const events = (evidence.evidenceJournal || []).filter(event => ids.includes(event.lectureId) && (!event.blockId || event.blockId === blockId));
 const sessions = new Set(events.filter(event => event.sessionKey).map(event => event.sessionKey));
 const historical = ids.reduce((sum, id) => sum + (getLecPerf?.({ id }, blockId)?.sessions || []).length, 0);
 const answers = events.length || ids.reduce((sum, id) => sum + (Number(evidence.lectures?.[id]?.attempts) || 0), 0);
 const quiz = Math.max(sessions.size, historical, answers > 0 ? 1 : 0);
 return { manual, quiz, total: manual + quiz, answers };
}
export function lectureReviewCount(lecture, blockId, completion, evidence, getLecPerf) {
 return lectureReviewActivity(lecture, blockId, completion, evidence, getLecPerf).total;
}
export function LectureProgressDashboard({ rows = [], completion = {}, evidence = {}, getLecPerf, blockId, objectives = [], onStudy, onQuiz, now: suppliedNow }) {
 const [clock, setClock] = useState(Date.now);
 useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 60000); return () => clearInterval(timer); }, []);
 const now = suppliedNow ?? clock;
 const accuracyFor = row => lectureReviewAccuracy(row.lec, evidence, getLecPerf, blockId);
 const timingFor = row => lectureReviewTiming(row, blockId, completion, evidence, getLecPerf, now);
 const [page, setPage] = useState(0);
 const [filter, setFilter] = useState("all"), [selectedId, setSelectedId] = useState(null);
 const ordered = useMemo(() => [...rows].filter(row => row.total > 0).filter(row => filter === "all" || (filter === "repair" ? row.st > 0 || (accuracyFor(row) != null && accuracyFor(row) < .8) : filter === "new" ? row.ut > 0 : filter === "due" || filter === "upcoming" ? timingFor(row).status === filter : lectureReviewCount(row.lec, blockId, completion, evidence, getLecPerf) > 0))
  .sort((a, b) => (["due", "upcoming"].includes(filter) ? String(timingFor(a).nextReview).localeCompare(String(timingFor(b).nextReview)) : filter === "reviewed" ? (timingFor(b).lastReviewedAt || 0) - (timingFor(a).lastReviewedAt || 0) : 0) || (["all", "repair"].includes(filter) ? (() => {
   const aAccuracy = accuracyFor(a), bAccuracy = accuracyFor(b);
   const aWeak = aAccuracy != null && aAccuracy < .8, bWeak = bAccuracy != null && bAccuracy < .8;
   return Number(bWeak) - Number(aWeak) || (aWeak && bWeak ? aAccuracy - bAccuracy : 0);
  })() : 0) || (filter === "new" ? (b.ut / b.total) - (a.ut / a.total) || b.ut - a.ut : 0) || (b.st / b.total) - (a.st / a.total) || (b.ut / b.total) - (a.ut / a.total) || Number(a.lec.lectureNumber || 0) - Number(b.lec.lectureNumber || 0)), [rows, filter, blockId, completion, evidence, getLecPerf, now]);
 const currentPage = Math.min(page, Math.max(0, Math.ceil(ordered.length / 6) - 1));
 const visible = ordered.slice(currentPage * 6, currentPage * 6 + 6);
 const selected = visible.find(row => row.lec.id === selectedId) || visible[0];
 return <section className="rounded-xl border border-border bg-panel p-4" aria-label="Lecture progress dashboard">
  <h3 className="text-lg font-bold">Where to focus next</h3>
  <p className="mt-1 text-sm text-text-2">Your six highest-priority lectures come first. Select a bar to review or quiz that lecture. Question practice counts as review activity. Objective coverage and mastery are tracked separately.</p>
  <div className="my-3 flex flex-wrap gap-2">{[["all", "All lectures"], ["repair", "Needs review"], ["new", "Not yet tested"], ["due", "Due for review"], ["upcoming", "Upcoming reviews"], ["reviewed", "Reviewed"]].map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelectedId(null); setPage(0); }} className={`rounded-lg border px-3 py-2 text-sm ${filter === key ? "border-accent bg-accent/10" : "border-border"}`}>{label}</button>)}</div>
  <p className="mb-3 text-xs text-text-2">{["due", "upcoming"].includes(filter) ? "Review dates run left to right: earliest due first." : filter === "reviewed" ? "Most recently reviewed lectures come first." : filter === "new" ? "Priority runs left to right: highest percentage of untested objectives first." : "Priority runs left to right: lowest recorded lecture accuracy first, then weak and untested objectives."}</p>
  <ul className="mb-3 flex flex-wrap gap-4 text-xs" aria-label="Chart legend">{segments.map(segment => <li key={segment.key} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={segmentStyle(segment)} />{segment.symbol} {segment.label}</li>)}</ul>
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2" aria-label="Lecture priority pages">
   <p className="text-sm font-semibold" aria-live="polite">{ordered.length ? currentPage === 0 ? `Top ${visible.length} of ${ordered.length} lectures` : `Priorities ${currentPage * 6 + 1}–${currentPage * 6 + visible.length} of ${ordered.length}` : "No matching lectures"}</p>
   {ordered.length > 6 && <div className="flex gap-2"><button type="button" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setSelectedId(null); }} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">← Previous six</button><button type="button" disabled={(currentPage + 1) * 6 >= ordered.length} onClick={() => { setPage(currentPage + 1); setSelectedId(null); }} className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">Next six →</button></div>}
  </div>
  <div aria-label="Vertical lecture priority chart">
   <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3 lg:grid-cols-6">{visible.map((row, index) => {
    const label = formatLectureLabel(row.lec), reviews = lectureReviewCount(row.lec, blockId, completion, evidence, getLecPerf);
    const timing = timingFor(row);
    return <button type="button" key={row.lec.id} aria-pressed={selected?.lec.id === row.lec.id} aria-label={`${label}: ${row.tested} of ${row.total} objectives covered, ${row.st} need review, ${row.ut} not yet tested, ${reviews} logged reviews`} onClick={() => setSelectedId(row.lec.id)} className={`flex min-w-0 flex-col items-center rounded-lg border p-2 text-center ${selected?.lec.id === row.lec.id ? "border-accent bg-accent/5" : "border-transparent"}`}>
     <span className="mb-1 text-xs text-text-2">#{currentPage * 6 + index + 1} priority</span>
     <strong className="text-sm">{row.coverage}% tested</strong>
     <span className="text-xs">{accuracyFor(row) == null ? "No accuracy data" : `${Math.round(accuracyFor(row) * 100)}% accuracy`}</span>
     <div className="my-2 flex h-48 w-12 flex-col-reverse overflow-hidden rounded-t border border-border" aria-hidden="true">{segments.filter(segment => row[segment.key] > 0).map(segment => <span key={segment.key} style={{ flex: `0 0 ${100 * row[segment.key] / row.total}%`, ...segmentStyle(segment) }} />)}</div>
     <strong className="text-xs">{row.lec.lectureType || "LEC"} {row.lec.lectureNumber ?? ""}</strong>
     <span className="mt-1 line-clamp-2 w-full text-xs" style={{ overflowWrap: "anywhere" }} title={label}>{row.lec.lectureTitle || row.lec.title || label}</span>
     <span className="mt-1 text-xs text-text-2">{reviews} review {reviews === 1 ? "session" : "sessions"}</span>
     <span className="mt-1 text-xs">Last review: {timing.lastReviewedAt ? reviewDateLabel(timing.lastReviewedAt) : reviews > 0 ? "Date unavailable" : "Not yet reviewed"}</span>
     <span className="mt-1 text-xs font-semibold">{timing.nextReview ? `${timing.status === "due" ? "Due for review" : "Next review"}: ${reviewDateLabel(timing.nextReview)}` : "Review date not scheduled"}</span>
     <span className="mt-1 text-xs">{segments.map(segment => <span className="block" key={segment.key}>{segment.symbol} {segment.label}: {row[segment.key]}</span>)}</span>
    </button>;
   })}</div>
  </div>
  {!ordered.length && <p className="py-4 text-sm">No lectures match this filter.</p>}
  {selected && <div className="mt-3 rounded-lg border border-border bg-bg p-3" aria-live="polite">
   <p className="mb-2 text-sm font-semibold">{timingFor(selected).nextReview ? `${timingFor(selected).status === "due" ? "Due for review" : "Next review"}: ${reviewDateLabel(timingFor(selected).nextReview)}` : "Start a question session or log a lecture review to establish review timing."}</p>
   <h4 className="font-bold">{formatLectureLabel(selected.lec)}</h4>
   <p className="mt-1 text-sm">{selected.tested}/{selected.total} objectives covered · {selected.st} need review · {selected.ut} not yet tested · {selected.m} mastered</p>
   <p className="mt-1 text-sm text-text-2">{lectureReviewCount(selected.lec, blockId, completion, evidence, getLecPerf)} logged reviews. {lectureReviewActivity(selected.lec, blockId, completion, evidence, getLecPerf).quiz} question-practice sessions · {lectureReviewActivity(selected.lec, blockId, completion, evidence, getLecPerf).manual} logged lecture reviews. {selected.st > 0 ? "Consolidate notes on missed concepts, then try a fresh quiz." : selected.ut > 0 ? "Cover the remaining lecture objectives, then test yourself." : "Keep building consistency with spaced practice."}</p>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!onStudy} onClick={() => onStudy?.(selected.lec.id)} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white">Review lecture →</button><button type="button" disabled={!onQuiz} onClick={() => onQuiz?.(objectives.filter(row => row.linkedLecId === selected.lec.id), formatLectureLabel(selected.lec), blockId, { lectureId: selected.lec.id })} className="rounded-lg border border-accent px-4 py-2 font-semibold">Quiz lecture →</button></div>
  </div>}
 </section>;
}
