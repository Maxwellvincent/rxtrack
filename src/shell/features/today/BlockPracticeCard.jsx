import { useEffect, useState } from "react";
import { useLectures } from "../../hooks/useLectures.js";
import { useLectureQuestionStats } from "../../hooks/useLectureQuestionStats.js";
import { listExamSessions } from "../../../supabase.js";
import { blockPracticeSummary } from "./blockPractice.js";
import { SchoolAlignmentPanel } from "./SchoolAlignmentPanel.jsx";

const percent = (n) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
export function BlockPracticeCard({ blockId, userId }) {
  const lectures = useLectures(blockId, userId);
  const stats = useLectureQuestionStats(userId);
  const [history, setHistory] = useState({ blockId: null, sessions: [], loading: true, error: false });
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setHistory({ blockId, sessions: [], loading: !!userId, error: false });
    if (userId) listExamSessions(userId, blockId).then((sessions) => {
      if (active) setHistory({ blockId, sessions, loading: false, error: false });
    }).catch(() => { if (active) setHistory({ blockId, sessions: [], loading: false, error: true }); });
    return () => { active = false; };
  }, [blockId, userId, refresh]);
  const result = blockPracticeSummary(blockId, lectures.data, stats.data, history.blockId === blockId ? history.sessions : []);
  const loading = stats.loading || history.loading || history.blockId !== blockId;
  const gap = result.accuracy == null ? null : (result.accuracy * 100 - 74);
  return <section aria-label="Block question progress" className="desk-practice rounded-lg border border-border bg-bg-elevated p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold">This block · question progress</h3>
      <button disabled={loading} onClick={() => setRefresh((n) => n + 1)} className="min-h-11 px-2 text-sm text-text-2">{loading ? "Syncing…" : "Refresh"}</button>
    </div>
    {history.error && <p role="alert" className="text-sm text-text-2">Exam history could not load. Showing lecture totals only—refresh to retry.</p>}
    {stats.error && <p role="alert" className="text-sm text-text-2">Lecture statistics could not fully sync. These totals may be incomplete.</p>}
    <div className="desk-practice-metrics my-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div><div className="text-2xl font-bold">{loading ? "—" : result.answered.toLocaleString()}</div><div className="text-sm text-text-2">Questions answered</div></div>
      <div><div className="text-2xl font-bold">{loading ? "—" : percent(result.accuracy)}</div><div className="text-sm text-text-2">Overall practice accuracy</div></div>
      <div><div className="text-2xl font-bold">74%</div><div className="text-sm text-text-2">Your benchmark</div></div>
    </div>
    {!loading && result.answered > 0 && <p className="text-sm">{result.correct} correct of {result.answered} answered · {Math.abs(gap).toFixed(1)} percentage points {gap >= 0 ? "above" : "below"} your benchmark.</p>}
    <details className="mt-3 text-sm">
      <summary className="min-h-11 cursor-pointer py-2 text-text-2">What these numbers mean</summary>
      <p>Counts saved lecture-quiz attempts and exam-session answers, including repeats. Overlapping exam records are not added twice. Deleted or untracked lecture history may be missing.</p>
      <p className="mt-2">Recent timed practice: {percent(result.timedAccuracy)} across {result.timedCount} submitted sessions ({result.timedQuestions} questions; latest five). Skipped questions count as incorrect in this timed score.</p>
      <p className="mt-2">Practice accuracy is not a predicted school-exam grade. Repeats, difficulty and topic coverage affect it. More questions alone do not establish improvement; compare fresh timed practice and actual school results. Your 74% benchmark does not calculate semester grading requirements.</p>
    </details>
    <SchoolAlignmentPanel blockId={blockId} userId={userId} sessions={history.blockId === blockId ? history.sessions : []} historyReady={!history.loading && !history.error && history.blockId === blockId} />
  </section>;
}
