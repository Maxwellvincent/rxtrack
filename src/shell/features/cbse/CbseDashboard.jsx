import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuestionBanks } from "../../hooks/useQuestionBanks.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { useTerms } from "../../hooks/useTerms.js";
import * as bankMetaStore from "../../../stores/questionBankMeta.js";
import * as weakStore from "../../../stores/weakConcepts.js";
import * as evidenceStore from "../../../stores/learnerEvidence.js";
import * as schoolResultsStore from "../../../stores/schoolResults.js";
import * as calibrationStore from "../../../stores/calibrationByBlock.js";
import * as termsStore from "../../../stores/terms.js";
import { createSessionShape } from "../../../examSessions.js";
import { createExamSession, listExamSessions } from "../../../supabase.js";
import { ExamSessionRunner } from "../exam/ExamSessionRunner.jsx";
import { ObjectiveProgressChart } from "../lectures/ObjectiveProgressChart.jsx";
import { examDurationMs } from "../exam/examTiming.js";
import { callAI } from "../../../aiClient.js";
import { CBSE_BLOCK_ID, buildCbsePool, cbseProgress, selectCbseQuestions } from "./cbsePrep.js";

const percent = value => value == null ? "—" : `${Math.round(value * 100)}%`;
export function ConceptBars({ rows, onReview }) {
  const [page, setPage] = useState(0), [selected, setSelected] = useState(null);
  const pages = Math.max(1, Math.ceil(rows.length / 6)), current = Math.min(page, pages - 1);
  const visible = rows.slice(current * 6, current * 6 + 6);
  const active = visible.find(row => row.id === selected) || visible[0];
  return <div>
    {!rows.length && <p className="py-6 text-text-2">Your results will appear here after practice. Uploaded report weaknesses are listed below.</p>}
    {!!visible.length && <div className="overflow-x-auto rounded-xl border border-border p-4">
      <div className="relative ml-8" style={{ minWidth: 420 }}>
        {[100, 50, 0].map(value => <div key={value} className="pointer-events-none absolute left-0 right-0 border-t border-border" style={{ top: 28 + (100-value)*1.8 }}><span className="absolute -left-9 -top-2 text-xs text-text-3">{value}%</span></div>)}
        <div className="relative grid gap-3" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(54px, 1fr))` }}>
          {visible.map((row, i) => <button key={row.id} type="button" aria-pressed={active?.id === row.id} aria-label={`${row.label}: ${percent(row.accuracy)}, ${row.answered} attempts`} className={`rounded-lg p-1 ${active?.id === row.id ? "ring-1 ring-accent" : ""}`} onClick={() => setSelected(row.id)}>
            <strong className="block text-sm" style={{ height: 28 }}>{percent(row.accuracy)}</strong>
            <span className="mx-auto flex items-end" style={{ height: 180, maxWidth: 56 }}><span className={`w-full rounded-t ${row.accuracy < .6 ? "bg-bad" : "bg-accent"}`} style={{ height: `${100*row.accuracy}%`, minHeight: 3 }} /></span>
            <span className="mt-3 block text-xs">{current*6+i+1} · {row.answered} Qs</span>
          </button>)}
        </div>
      </div>
    </div>}
    {active && <div className="mt-3 rounded-lg bg-bg-elevated p-3 text-sm"><strong>{active.label}</strong><p className="mt-1 text-text-2">{active.source === "report" ? `Reported score: ${percent(active.accuracy)} · ${active.answered} category items` : `${active.correct}/${active.answered} correct · ${percent(active.accuracy)} accuracy`}</p>{active.lectureId && <button className="mt-2 text-accent underline" onClick={() => onReview(active.lectureId)}>Review original lecture</button>}</div>}
    {pages > 1 && <div className="mt-3 flex justify-between text-sm"><button disabled={!current} onClick={() => setPage(current-1)}>← Previous</button><span>{current+1}/{pages}</span><button disabled={current+1 >= pages} onClick={() => setPage(current+1)}>Next →</button></div>}
  </div>;
}

export function CbseDashboard({ userId, block, onReviewLecture, onManageSources }) {
  const banks = useQuestionBanks(userId), meta = useStoreResource(bankMetaStore, userId), lectures = useLectures(null, userId);
  const objectives = useObjectives(null, userId), terms = useTerms(userId), weak = useStoreResource(weakStore, userId);
  const evidence = useStoreResource(evidenceStore, userId), calibration = useStoreResource(calibrationStore, userId);
  const schoolResults = useStoreResource(schoolResultsStore, userId);
  const [history, setHistory] = useState({ userId: null, sessions: [], error: null });
  const [refresh, setRefresh] = useState(0), [active, setActive] = useState(null), [reviewing, setReviewing] = useState(false);
  const [count, setCount] = useState(15), [mode, setMode] = useState("balanced"), [source, setSource] = useState("all");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [chart, setChart] = useState("concepts");
  const [importBlock, setImportBlock] = useState("");
  const [examStart, setExamStart] = useState(block.examDate || "2026-12-09"), [examEnd, setExamEnd] = useState(block.examWindowEnd || "2026-12-10");
  useEffect(() => {
    let alive = true;
    listExamSessions(userId, null).then(sessions => { if (alive) setHistory({ userId, sessions, error: null }); })
      .catch(e => { if (alive) setHistory({ userId, sessions: [], error: e.message || "Could not load exam history." }); });
    return () => { alive = false; };
  }, [userId, refresh]);
  const sessions = useMemo(() => history.userId === userId ? history.sessions : [], [history, userId]);
  const pool = useMemo(() => buildCbsePool(banks.data, meta.data, lectures.data, terms.data), [banks.data, meta.data, lectures.data, terms.data]);
  const progress = useMemo(() => cbseProgress({ sessions, calibration: calibration.data, weakConcepts: weak.data, objectives: objectives.data, evidence: evidence.data, lectures: lectures.data }), [sessions, calibration.data, weak.data, objectives.data, evidence.data, lectures.data]);
  const labels = useMemo(() => Object.fromEntries((lectures.data || []).map(l => [l.id, l.lectureTitle || l.title])), [lectures.data]);
  const objectiveMap = useMemo(() => Object.fromEntries(progress.objectives.map(o => [o.id, { id: o.id, objective: o.text }])), [progress.objectives]);
  const resources = [banks, meta, lectures, objectives, terms, weak, evidence, calibration, schoolResults];
  const loading = resources.some(resource => resource.loading) || history.userId !== userId;
  const loadError = resources.find(resource => resource.error)?.error?.message || (history.userId === userId ? history.error : null);
  const completed = useCallback(() => { setActive(null); setRefresh(value => value+1); }, []);
  const launch = async format => {
    setError(""); setBusy(true);
    try {
      const selected = selectCbseQuestions(pool.questions, progress, { count: Number(count), mode, source });
      if (selected.error) throw new Error(selected.error);
      const now = Date.now(), sessionId = crypto.randomUUID();
      const session = createSessionShape({ sessionId, blockId: CBSE_BLOCK_ID, format, title: "CBSE Prep", contentScope: "cbse:all-terms",
        questions: selected.questions, lectureIds: [...new Set(selected.questions.map(q => q.lectureId).filter(Boolean))], sourceType: "question-bank", sourceFile: "CBSE Prep · mixed school questions",
        startedAt: format === "exam" ? now : null, deadline: format === "exam" ? now+examDurationMs(selected.questions.length) : null });
      const result = await createExamSession(userId, session);
      if (!result?.ok) throw new Error(result?.error || "Could not save the practice session.");
      setReviewing(false); setActive(sessionId);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const saveDates = async () => {
    setBusy(true); setError("");
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(examStart) || !/^\d{4}-\d{2}-\d{2}$/.test(examEnd) || examEnd < examStart) throw new Error("Choose a valid exam date window.");
      const current = termsStore.read(userId) || [];
      await termsStore.writeAwait(userId, current.map(term => ({ ...term, blocks: (term.blocks || []).map(item => item.id === CBSE_BLOCK_ID ? { ...item, examDate: examStart, examWindowEnd: examEnd } : item) })));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (active) return <div className="p-5"><ExamSessionRunner sessionId={active} userId={userId} blockId={CBSE_BLOCK_ID} blockName="CBSE Prep" lectures={lectures.data || []} objectivesById={objectiveMap} lectureLabelsByLectureId={labels} onNavigateToLecture={onReviewLecture} onExit={completed} onSubmitted={reviewing ? null : completed} callAI={callAI} /></div>;
  const focus = progress.concepts.filter(row => row.accuracy < .7).slice(0, 5);
  const originalBlocks = (terms.data || []).flatMap(term => (term.blocks || []).filter(item => item.id !== CBSE_BLOCK_ID).map(item => ({ ...item, termName: term.name })));
  const reportRows = progress.reports.filter(row => row.tags?.includes("exam-report"));
  const due = new Date(`${block.examDate || examStart}T00:00:00`), days = Math.max(0, Math.ceil((due-new Date())/86400000));
  return <div className="mx-auto max-w-6xl space-y-6 p-5 sm:p-8">
    <header><p className="text-sm font-semibold text-accent">All terms · comprehensive practice</p><h1 className="mt-1 text-3xl font-bold">CBSE Prep</h1><p className="mt-2 text-text-2">Practice → review → repair → retest · Exam window {block.examDate || examStart} – {block.examWindowEnd || examEnd} · {days} days to the earlier date</p></header>
    {loading && <p role="status">Loading school sources and performance across your terms…</p>}
    {(error || loadError) && <div role="alert" className="rounded-lg border border-bad p-3">{error || loadError}<button className="ml-3 underline" onClick={() => setRefresh(value => value+1)}>Reload results</button></div>}
    <section className="rounded-xl border border-accent/40 bg-panel p-5"><h2 className="text-lg font-semibold">Your next practice</h2><div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-sm">Questions<input aria-label="Question count" type="number" min="1" max="80" value={count} onChange={e => setCount(e.target.value)} className="mt-1 block w-24 rounded border border-border bg-bg p-2" /></label>
      <label className="text-sm">Focus<select value={mode} onChange={e => setMode(e.target.value)} className="mt-1 block rounded border border-border bg-bg p-2"><option value="balanced">Mixed review</option><option value="weak">Weak areas & missed questions</option><option value="unseen">Unseen school questions</option></select></label>
      <label className="text-sm">Sources<select value={source} onChange={e => setSource(e.target.value)} className="mt-1 block rounded border border-border bg-bg p-2"><option value="all">All school & supplemental banks</option><option value="examsoft">ExamSoft only</option></select></label>
      <button disabled={loading || !!loadError || busy || !Number.isInteger(Number(count)) || Number(count)<1 || Number(count)>80} className="rounded-lg bg-accent px-5 py-3 font-semibold text-white disabled:opacity-40" onClick={() => launch("practice")}>Practice quiz</button>
      <button disabled={loading || !!loadError || busy || !Number.isInteger(Number(count)) || Number(count)<1 || Number(count)>80} className="rounded-lg border border-accent px-5 py-3 font-semibold disabled:opacity-40" onClick={() => launch("exam")}>Timed practice exam</button>
    </div><p className="mt-3 text-sm text-text-2">{pool.questions.length} eligible original questions · {pool.sources} uploaded banks · timed practice uses 90 seconds per question</p></section>
    {!loading && <div className="grid gap-3 sm:grid-cols-4">{[["Questions answered", progress.answered], ["Practice accuracy", percent(progress.accuracy)], ["Objectives practiced", `${progress.objectives.filter(row => row.worked).length}/${progress.objectives.length}`], ["Report weaknesses", reportRows.length]].map(([label,value]) => <div key={label} className="rounded-xl border border-border p-4"><p className="text-sm text-text-2">{label}</p><strong className="mt-2 block text-2xl">{value}</strong></div>)}</div>}
    {!!sessions.filter(s => s.blockId === CBSE_BLOCK_ID && ["in_progress", "finalizing"].includes(s.status)).length && <section className="rounded-xl border border-border p-4"><h2 className="font-semibold">Continue practice</h2>{sessions.filter(s => s.blockId === CBSE_BLOCK_ID && ["in_progress", "finalizing"].includes(s.status)).map(s => <button key={s.sessionId} className="mr-3 mt-2 rounded border border-border p-2" onClick={() => { setReviewing(false); setActive(s.sessionId); }}>Resume {s.format === "exam" ? "timed exam" : "quiz"} · {s.questions?.length} questions</button>)}</section>}
    <section className="rounded-xl border border-border p-5"><h2 className="text-lg font-semibold">What needs work</h2><p className="mt-1 text-sm text-text-2">Practice accuracy reflects your answered attempts; it is not a predicted CBSE score.</p><div className="my-4 flex gap-2">{[["concepts","Concepts"],["objectives","Objectives"],["reports","Report categories"]].map(([id,label]) => <button key={id} aria-pressed={chart === id} className={`rounded-full border px-4 py-2 ${chart === id ? "border-accent text-accent" : "border-border"}`} onClick={() => setChart(id)}>{label}</button>)}</div>
      {loading ? <p role="status">Loading performance…</p> : chart === "objectives" ? <ObjectiveProgressChart rows={progress.objectives} /> : <ConceptBars key={chart} rows={chart === "reports" ? reportRows.filter(row => row.reportScore != null).map(row => ({ id: `${row.blockId}:${row.id}`, label: row.concept, source: "report", accuracy: row.reportScore/100, answered: row.reportSampleSize || row.totalAttempts || 0, correct: null, lectureId: row.linkedLecIds?.[0] })) : progress.concepts} onReview={onReviewLecture} />}
      <p className="mt-3 text-xs text-text-3">{progress.unlinked} answered attempts lack verified objective links. They count toward practice results but cannot establish objective mastery.</p>
    </section>
    <section className="grid gap-5 md:grid-cols-2"><div className="rounded-xl border border-border p-5"><h2 className="text-lg font-semibold">Review next</h2>{!focus.length && <p className="mt-3 text-text-2">Complete a mixed quiz to reveal your next targets.</p>}{focus.map(row => <div key={row.id} className="border-b border-border py-3 text-sm"><strong>{row.label}</strong><p className="text-text-2">{row.correct}/{row.answered} correct · review the explanation, reconstruct the connection, then retest.</p>{row.lectureId && <button className="mt-1 text-accent underline" onClick={() => onReviewLecture(row.lectureId)}>Open lecture</button>}</div>)}</div>
      <div className="rounded-xl border border-border p-5"><h2 className="text-lg font-semibold">Previously identified weaknesses</h2><p className="mt-1 text-xs text-text-3">Uploaded report scores are historical evidence, separate from practice accuracy. Showing the highest-priority saved weaknesses.</p>{!progress.reports.length && <p className="mt-3 text-text-2">No saved report or weak-concept entries found.</p>}{progress.reports.slice(0,8).map((row,i) => <div key={`${row.blockId}:${row.id || i}`} className="border-b border-border py-3 text-sm"><strong>{row.concept}</strong><p className="text-text-2">{row.blockName || row.blockId} · {row.reportScore != null ? `Report: ${Math.round(row.reportScore)}%` : `${row.missCount || 0} recorded misses`}</p>{row.linkedLecIds?.[0] && <button className="text-accent underline" onClick={() => onReviewLecture(row.linkedLecIds[0])}>Review linked lecture</button>}</div>)}</div></section>
    {!!Object.keys(schoolResults.data || {}).length && <section className="rounded-xl border border-border p-5"><h2 className="text-lg font-semibold">Uploaded school grades</h2><p className="mt-1 text-xs text-text-3">Official report snapshots stay separate from your app practice attempts.</p>{Object.values(schoolResults.data || {}).sort((a,b) => String(b.date).localeCompare(String(a.date))).slice(0,10).map(row => <div key={row.id} className="flex justify-between gap-3 border-b border-border py-3 text-sm"><span>{row.name} · {row.date}</span><strong>{Math.round(row.percent)}%</strong></div>)}</section>}
    <section className="rounded-xl border border-border p-5"><h2 className="text-lg font-semibold">Scores & recent attempts</h2>{!progress.history.length && <p className="mt-3 text-text-2">Your completed school quizzes and exams will appear here.</p>}{progress.history.slice(0,10).map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-3 text-sm"><span>{row.label}<small className="ml-2 text-text-3">{new Date(row.at).toLocaleDateString()}</small></span><span>{row.correct}/{row.answered} · {percent(row.correct/row.answered)} <button className="ml-3 text-accent underline" onClick={() => { setReviewing(true); setActive(row.id); }}>Review</button></span></div>)}</section>
    <details id="cbse-sources" className="rounded-xl border border-border p-5"><summary className="cursor-pointer font-semibold">Sources & exam dates</summary><p className="mt-3 text-sm text-text-2">Original banks stay in their own blocks. {pool.excluded} incomplete items excluded; {pool.duplicates} exact duplicates consolidated. Existing questions are reused faithfully.</p><div className="mt-3 flex flex-wrap gap-2"><select aria-label="Original block for import" value={importBlock} onChange={e => setImportBlock(e.target.value)} className="rounded border border-border bg-bg p-2"><option value="">Choose original block…</option>{originalBlocks.map(item => <option key={item.id} value={item.id}>{item.termName} · {item.name}</option>)}</select><button disabled={!importBlock} className="rounded border border-border px-3 py-2 disabled:opacity-40" onClick={() => onManageSources(importBlock)}>Import school questions or reports</button></div><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm">Earliest exam date<input type="date" value={examStart} onChange={e => setExamStart(e.target.value)} className="block rounded border border-border bg-bg p-2" /></label><label className="text-sm">Latest exam date<input type="date" value={examEnd} onChange={e => setExamEnd(e.target.value)} className="block rounded border border-border bg-bg p-2" /></label><button disabled={busy} className="rounded border border-border px-3 py-2" onClick={saveDates}>Save exam window</button></div></details>
  </div>;
}
