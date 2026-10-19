import { useState } from "react";
import { formatLectureLabel } from "../../../lectureTitle.js";

const percent = value => value == null ? "—" : `${Math.round(value * 100)}%`;
const filters = [["priority", "Review first"], ["all", "All lectures"], ["untested", "Not tested"], ["links", "Missing links"]];

/** Presentation only: scoring, evidence and review ordering remain owned by the dashboard. */
export function WeakAreaDashboard({ rows = [], priorityIds = [], lecturesById = {}, onReviewLecture, unlinkedAnswers = 0, unlinkedReportTopics = [] }) {
  const [filter, setFilter] = useState("priority");
  const [metric, setMetric] = useState("accuracy");
  const [selectedId, setSelectedId] = useState(null);
  const priorities = new Set(priorityIds);
  const counts = {
    priority: priorityIds.length, all: rows.length,
    untested: rows.filter(row => !row.totalQuestions).length,
    links: rows.filter(row => row.objectiveLinksMissing).length,
  };
  const visible = rows.filter(row => filter === "priority" ? priorities.has(row.lectureId)
    : filter === "untested" ? !row.totalQuestions : filter === "links" ? row.objectiveLinksMissing : true);
  const selected = visible.find(row => row.lectureId === selectedId) || visible[0];
  const label = row => formatLectureLabel(lecturesById[row.lectureId] || row.lecture);
  const shortLabel = row => {
    const lecture = lecturesById[row.lectureId] || row.lecture;
    return lecture.lectureNumber != null ? `LEC ${lecture.lectureNumber}` : label(row).replace(/^LEC\s*(\d+).*/, "LEC $1");
  };
  const needsReview = rows.filter(row => (row.priorityAccuracy ?? row.accuracy) != null && (row.priorityAccuracy ?? row.accuracy) < .8).length;
  const exposure = row => row.objectiveTotal && !row.objectiveLinksMissing ? row.objectivesTested / row.objectiveTotal : null;

  return <section className="mb-5 min-w-0 rounded-xl border border-border bg-panel p-4 sm:p-5" aria-label="Overall weak-area map">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-accent">Review → retest → improve</p>
        <h2 className="mt-1 text-xl font-semibold text-text-1">Overall weak-area map</h2>
        <p className="mt-1 max-w-2xl text-sm text-text-2">Compare lectures, select a bar, then review what needs attention.</p>
      </div>
      <span className="rounded-full border border-border px-3 py-1 text-xs text-text-2">{priorityIds.length} to prioritize · {rows.length} lectures</span>
    </div>

    <div className="mt-4 grid grid-cols-3 gap-2">
      {[[needsReview, "Need review", "Recent or lifetime below 80%", "text-bad"], [counts.untested, "Not tested", "No graded practice yet", "text-text-1"], [counts.links, "Linking gaps", "Practice without objective links", "text-warn"]].map(([value, title, note, tone]) =>
        <div key={title} className="min-w-0 rounded-lg border border-border bg-bg-elevated p-3"><div className={`text-2xl font-bold ${tone}`}>{value}</div><div className="mt-1 text-xs font-semibold text-text-1 sm:text-sm">{title}</div><p className="mt-1 hidden text-xs text-text-3 sm:block">{note}</p></div>)}
    </div>

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter lectures">{filters.map(([key, title]) => <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-10 rounded-full border px-3 py-1.5 text-xs font-semibold ${filter === key ? "border-accent bg-accent/10 text-accent" : "border-border text-text-2 hover:bg-bg-elevated"}`}>{title} <span className="ml-1 opacity-70">{counts[key]}</span></button>)}</div>
      <div className="flex rounded-lg border border-border p-1" role="group" aria-label="Chart metric">{[["accuracy", "Accuracy"], ["coverage", "Objectives seen"]].map(([key, title]) => <button key={key} type="button" aria-pressed={metric === key} onClick={() => setMetric(key)} className={`min-h-9 rounded-md px-3 text-xs font-semibold ${metric === key ? "bg-bg-elevated text-text-1 shadow-sm" : "text-text-3"}`}>{title}</button>)}</div>
    </div>

    <div className="mt-4 rounded-lg border border-border bg-bg-elevated p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-2">
        <h3 className="font-semibold text-text-1">{metric === "accuracy" ? "Accuracy by lecture" : "Objective exposure by lecture"}</h3>
        <div className="flex gap-3">{metric === "accuracy" ? <><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent"/>Recent</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-status-blue/60"/>Lifetime</span></> : <span>Seen ≠ mastered</span>}</div>
      </div>
      {visible.length ? <div className="mt-3 flex min-w-0 gap-2">
        <div className="relative mt-7 h-[180px] w-8 shrink-0 text-[10px] text-text-3" aria-hidden="true">{[100,75,50,25,0].map(value => <span key={value} className="absolute right-0 -translate-y-1/2" style={{top:`${100-value}%`}}>{value}%</span>)}</div>
        <div className="min-w-0 flex-1 overflow-x-auto pb-2" tabIndex={0} aria-label="Lecture comparison chart; scroll for more lectures">
          <div className="grid" style={{gridTemplateColumns:`repeat(${visible.length}, minmax(92px, 1fr))`, minWidth:visible.length * 92}}>
            {visible.map(row => {
              const active = selected?.lectureId === row.lectureId;
              const values = metric === "accuracy" ? [row.recentCount >= 3 ? row.recentAccuracy : null, row.accuracy] : [exposure(row)];
              return <button key={row.lectureId} type="button" aria-pressed={active} aria-label={`Select ${label(row)}. ${metric === "accuracy" ? `Recent ${row.recentCount >= 3 ? percent(row.recentAccuracy) : "insufficient data"}, lifetime ${row.accuracy == null ? "no data" : percent(row.accuracy)}` : `Objectives seen ${exposure(row) == null ? "unavailable" : percent(exposure(row))}`}`} title={label(row)} onClick={() => setSelectedId(row.lectureId)} className={`min-w-0 rounded-md px-1 pb-2 text-center focus-visible:outline-2 focus-visible:outline-accent ${active ? "bg-accent/5 ring-1 ring-inset ring-accent/40" : "hover:bg-panel"}`}>
                <span className="relative block h-[208px]">
                  <span className="absolute inset-x-0 bottom-0 h-[180px]" aria-hidden="true">
                    {[0,25,50,75,100].map(value => <span key={value} className="absolute inset-x-0 border-t border-border/60" style={{bottom:`${value}%`}}/>)}
                    <span className="absolute inset-0 flex items-end justify-center gap-3 px-2">{values.map((value,index) => <span key={index} className="relative h-full w-full max-w-6">
                      <span className="absolute inset-x-[-6px] whitespace-nowrap text-[10px] font-semibold text-text-2" style={{bottom:`calc(${(value ?? 0)*100}% + 4px)`}}>{value == null ? "—" : percent(value)}</span>
                      {value != null ? <span data-bar="vertical" data-value={value} className={`absolute inset-x-0 bottom-0 rounded-t-sm ${metric === "coverage" || index === 0 ? "bg-accent" : "bg-status-blue/60"}`} style={{height:`${value*100}%`}}/> : <span className="absolute inset-x-0 bottom-0 h-1 border-t border-dashed border-text-3/50"/>}
                    </span>)}</span>
                  </span>
                </span>
                <span className={`mt-3 block truncate text-[11px] font-semibold ${active ? "text-accent" : "text-text-2"}`}>{shortLabel(row)}</span>
              </button>;
            })}
          </div>
        </div>
      </div> : <p className="py-10 text-center text-sm text-text-2">No lectures in this view. Try All lectures.</p>}
      <p className="mt-2 text-xs text-text-3">{metric === "accuracy" ? "Recent = up to 8 answers, shown after at least 3. A dash means insufficient data, not 0%." : "Exposure shows objectives with recorded evidence. Missing links have no coverage score; exposure is not mastery."}</p>
    </div>

    {selected && <article className="mt-4 rounded-lg border border-border bg-bg-elevated p-4" aria-label="Selected lecture review">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wider text-accent">Selected lecture</p><h3 className="mt-1 break-words text-base font-semibold text-text-1">{label(selected)}</h3></div>
        <button type="button" disabled={!onReviewLecture} onClick={() => onReviewLecture?.(selected.lectureId)} className="min-h-11 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto">Review &amp; retest →</button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div><p className="text-xs text-text-3">Recent accuracy</p><p className="mt-1 text-2xl font-semibold text-text-1">{selected.recentCount >= 3 ? percent(selected.recentAccuracy) : "—"}</p><p className="mt-1 text-xs text-text-2">{selected.recentCount >= 3 ? `Recent ${selected.recentCount} answers: ${percent(selected.recentAccuracy)} correct` : "At least 3 answers needed"}</p></div>
        <div><p className="text-xs text-text-3">Lifetime accuracy</p><p className="mt-1 text-2xl font-semibold text-text-1">{percent(selected.accuracy)}</p><p className="mt-1 text-xs text-text-2">{selected.totalQuestions ? `${percent(selected.accuracy)} correct · ${selected.misses} missed of ${selected.totalQuestions}` : "No graded practice yet"}</p></div>
        <div className="col-span-2 border-t border-border pt-3 sm:col-span-1 sm:border-0 sm:pt-0"><p className="text-xs text-text-3">Objective exposure</p><p className="mt-1 text-2xl font-semibold text-text-1">{exposure(selected) == null ? "—" : `${selected.objectivesTested}/${selected.objectiveTotal}`}</p><p className="mt-1 text-xs text-text-2">{selected.objectiveLinksMissing ? "Practice recorded · objective links incomplete" : selected.objectiveTotal ? `${selected.objectivesTested}/${selected.objectiveTotal} objectives seen · ${selected.objectivesUntested} untested` : "No linked objectives"}</p></div>
      </div>
      {!!selected.strugglingObjectives && <p className="mt-4 rounded-md bg-bad/5 px-3 py-2 text-sm text-bad">{selected.strugglingObjectives} objective{selected.strugglingObjectives === 1 ? "" : "s"} need attention. Review your notes or redraw the difficult connections, then retest.</p>}
      {!!selected.reportTopics?.length && <p className="mt-2 text-sm text-text-2">Exam-report review: {selected.reportTopics.join("; ")}</p>}
    </article>}

    {(unlinkedAnswers > 0 || unlinkedReportTopics.length > 0) && <details className="mt-3 rounded-lg border border-warn/40 p-3 text-sm text-text-2"><summary className="cursor-pointer font-semibold">Saved evidence awaiting lecture links</summary>{unlinkedAnswers > 0 && <p className="mt-1">{unlinkedAnswers} completed answers are saved but cannot yet target a lecture.</p>}{!!unlinkedReportTopics.length && <p className="mt-1">Unlinked report topics: {unlinkedReportTopics.join("; ")}</p>}</details>}
    <details className="mt-3 text-xs text-text-3"><summary className="cursor-pointer py-1 font-semibold">Sources &amp; calculation</summary><p className="mt-1">Lecture quizzes, saved homework, ExamSoft, IMCQ and exam answers contribute. Save &amp; exit publishes completed answers without ending the session. Review order uses recent accuracy after three answers, otherwise lifetime accuracy; uploaded report topics and untested objectives remain separate signals. Objective exposure means seen, not mastered. Repeated saves do not duplicate answers.</p></details>
  </section>;
}
