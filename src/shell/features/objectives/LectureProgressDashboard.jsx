import { useMemo, useState } from "react";
import { formatLectureLabel } from "../../../lectureTitle.js";
const segments = [{ key: "m", label: "Mastered", color: "var(--color-good, #2563a6)" }, { key: "ip", label: "Learning", color: "var(--color-accent, #187876)" }, { key: "st", label: "Needs review", color: "var(--color-bad, #a13c60)" }, { key: "ut", label: "Not yet tested", color: "var(--color-border, #d9dcd8)" }];
export function lectureReviewCount(lecture, blockId, completion) {
 const ids = [...new Set([lecture.id, ...(lecture.mergedFrom || []).map(row => row.id)])];
 const reviews = ids.flatMap(id => completion?.[`${id}__${blockId}`]?.activityLog || []).filter(row => row.activityType === "review");
 return new Set(reviews.map(row => row.id || JSON.stringify(row))).size;
}
export function LectureProgressDashboard({ rows = [], completion = {}, blockId, objectives = [], onStudy, onQuiz }) {
 const [filter, setFilter] = useState("all"), [selectedId, setSelectedId] = useState(null);
 const ordered = useMemo(() => [...rows].filter(row => row.total > 0).filter(row => filter === "all" || (filter === "repair" ? row.st > 0 : filter === "new" ? row.ut > 0 : lectureReviewCount(row.lec, blockId, completion) > 0))
  .sort((a, b) => (filter === "new" ? (b.ut / b.total) - (a.ut / a.total) || b.ut - a.ut : 0) || (b.st / b.total) - (a.st / a.total) || (b.ut / b.total) - (a.ut / a.total) || Number(a.lec.lectureNumber || 0) - Number(b.lec.lectureNumber || 0)), [rows, filter, blockId, completion]);
 const selected = ordered.find(row => row.lec.id === selectedId) || ordered[0];
 return <section className="rounded-xl border border-border bg-panel p-4" aria-label="Lecture progress dashboard">
  <h3 className="text-lg font-bold">Where to focus next</h3>
  <p className="mt-1 text-sm text-text-2">Each vertical bar represents one lecture’s objectives. Select a lecture to review or quiz it. Review logs are shown separately from question coverage.</p>
  <div className="my-3 flex flex-wrap gap-2">{[["all", "All lectures"], ["repair", "Needs review"], ["new", "Not yet tested"], ["reviewed", "Reviewed"]].map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => { setFilter(key); setSelectedId(null); }} className={`rounded-lg border px-3 py-2 text-sm ${filter === key ? "border-accent bg-accent/10" : "border-border"}`}>{label}</button>)}</div>
  <p className="mb-3 text-xs text-text-2">{filter === "new" ? "Priority runs left to right: highest percentage of untested objectives first." : "Priority runs left to right: lectures with the most weak objectives proportionally come first."}</p>
  <ul className="mb-3 flex flex-wrap gap-4 text-xs" aria-label="Chart legend">{segments.map(segment => <li key={segment.key} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm" style={{ background: segment.color }} />{segment.label}</li>)}</ul>
  <div className="overflow-x-auto pb-3" tabIndex={0} aria-label="Scrollable vertical lecture chart">
   <div className="flex items-start gap-2" style={{ minWidth: "100%" }}>{ordered.map(row => {
    const label = formatLectureLabel(row.lec), reviews = lectureReviewCount(row.lec, blockId, completion);
    return <button type="button" key={row.lec.id} aria-pressed={selected?.lec.id === row.lec.id} aria-label={`${label}: ${row.tested} of ${row.total} objectives covered, ${row.st} need review, ${row.ut} not yet tested, ${reviews} logged reviews`} onClick={() => setSelectedId(row.lec.id)} className={`flex shrink-0 flex-col items-center rounded-lg border p-2 text-center ${selected?.lec.id === row.lec.id ? "border-accent bg-accent/5" : "border-transparent"}`} style={{ width: 104 }}>
     <strong className="text-sm">{row.coverage}%</strong>
     <div className="my-2 flex h-48 w-12 flex-col-reverse overflow-hidden rounded-t border border-border" aria-hidden="true">{segments.filter(segment => row[segment.key] > 0).map(segment => <span key={segment.key} style={{ flex: `0 0 ${100 * row[segment.key] / row.total}%`, background: segment.color }} />)}</div>
     <strong className="text-xs">{row.lec.lectureType || "LEC"} {row.lec.lectureNumber ?? ""}</strong>
     <span className="mt-1 line-clamp-2 w-full text-xs" style={{ overflowWrap: "anywhere" }} title={label}>{row.lec.lectureTitle || row.lec.title || label}</span>
     <span className="mt-1 text-xs text-text-2">{reviews} reviews</span>
    </button>;
   })}</div>
  </div>
  {!ordered.length && <p className="py-4 text-sm">No lectures match this filter.</p>}
  {selected && <div className="mt-3 rounded-lg border border-border bg-bg p-3" aria-live="polite">
   <h4 className="font-bold">{formatLectureLabel(selected.lec)}</h4>
   <p className="mt-1 text-sm">{selected.tested}/{selected.total} objectives covered · {selected.st} need review · {selected.ut} not yet tested · {selected.m} mastered</p>
   <p className="mt-1 text-sm text-text-2">{lectureReviewCount(selected.lec, blockId, completion)} logged reviews. {selected.st > 0 ? "Review missed concepts, then try a fresh quiz." : selected.ut > 0 ? "Cover the remaining lecture objectives, then test yourself." : "Keep building consistency with spaced practice."}</p>
   <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!onStudy} onClick={() => onStudy?.(selected.lec.id)} className="rounded-lg bg-accent px-4 py-2 font-semibold text-white">Review lecture →</button><button type="button" disabled={!onQuiz} onClick={() => onQuiz?.(objectives.filter(row => row.linkedLecId === selected.lec.id), formatLectureLabel(selected.lec), blockId, { lectureId: selected.lec.id })} className="rounded-lg border border-accent px-4 py-2 font-semibold">Quiz lecture →</button></div>
  </div>}
 </section>;
}
