import { SchoolAlignmentPanel } from "./SchoolAlignmentPanel.jsx";
import { SCHOOL_EXAM_TARGET_PERCENT } from "../../logic/performanceTargets.js";

import {useQuestionPractice} from "../../hooks/useQuestionPractice.js";
import {questionProgress} from "../exam/questionProgress.js";

const percent = (n) => n == null ? "—" : `${(n * 100).toFixed(1)}%`;
export function CompactQuestionProgress({ blockId, userId }) {
  const {studyAnswers,sessions,manualEntries,historicalStudy,loading,error}=useQuestionPractice(userId,blockId);
  const result=questionProgress(studyAnswers,sessions,{},manualEntries,historicalStudy);
  return <section aria-label="Block question progress" className="desk-practice rounded-lg border border-border bg-bg-elevated p-4">
    <div className="flex items-start justify-between gap-3">
      <div><div className="today-eyebrow">Practice pulse</div><h3 className="mt-1 text-base font-semibold">Questions completed</h3></div>
      <span className="today-signal-dot" aria-hidden="true" />
    </div>
    <div className="today-mini-metrics mt-3">
      <div><strong>{loading ? "—" : result.answered.toLocaleString()}</strong><span>completed</span></div>
      <div><strong>{loading ? "—" : result.correct.toLocaleString()}</strong><span>correct scored answers</span></div>
      <div><strong>{loading ? "—" : percent(result.accuracy)}</strong><span>scored accuracy</span></div>
    </div>
    {!loading && <><p className="mt-2 text-sm">{result.correct} correct of {result.gradedAnswered} scored · {result.answered-result.gradedAnswered} without a score.</p>
    <details className="mt-2 text-xs text-text-2"><summary className="cursor-pointer py-2">Question-count breakdown</summary><ul><li>{result.lectureAnswered-(historicalStudy?.answered||0)} dated lecture-quiz answers</li><li>{historicalStudy?.answered||0} older recorded practice answers</li><li>{result.schoolAnswered} saved homework / school-bank answers</li><li>{result.examAnswered} saved integrated-exam answers</li><li>{result.manualAnswered} outside-practice questions</li></ul><p>Mirrored answer logs count once. Later retakes count again. Older aggregate history is included in lifetime totals only, because its individual answer dates are unavailable.</p></details></>}
    {error && <p role="alert">Some practice history could not load. Totals may be incomplete.</p>}
    <p className="mt-2 text-xs text-text-2">Saved lecture quizzes, homework, exam answers and outside practice. Retakes count; repeat saves do not. Accuracy uses only questions with a score.</p>
  </section>;
}

export function BlockPracticeCard({ blockId, userId, compact = false }) {
  const history=useQuestionPractice(userId,blockId);
  const result=questionProgress(history.studyAnswers,history.sessions,{},history.manualEntries,history.historicalStudy);
  const gap=result.accuracy==null?null:result.accuracy*100-SCHOOL_EXAM_TARGET_PERCENT;
  if(compact)return <CompactQuestionProgress blockId={blockId} userId={userId}/>;
  return <section aria-label="Block question progress" className="desk-practice rounded-lg border border-border bg-bg-elevated p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold">This block · question progress</h3><button disabled={history.loading} onClick={history.refresh} className="min-h-11 px-2 text-sm text-text-2">{history.loading?'Syncing…':'Refresh'}</button></div>
    {history.error&&<p role="alert" className="text-sm text-text-2">Some practice history could not load; totals may be incomplete. Refresh to retry.</p>}
    <div className="desk-practice-metrics my-3 grid grid-cols-2 gap-3 sm:grid-cols-3"><div><strong>{history.loading?'—':result.answered}</strong><div>Questions answered</div></div><div><strong>{history.loading?'—':percent(result.accuracy)}</strong><div>Scored practice accuracy</div></div><div><strong>{SCHOOL_EXAM_TARGET_PERCENT}%</strong><div>School-exam target</div></div></div>
    {!history.loading&&<p>{result.correct} correct of {result.gradedAnswered} scored · {result.answered-result.gradedAnswered} without a score.{gap!=null&&` ${Math.abs(gap).toFixed(1)} percentage points ${gap>=0?'above':'below'} your benchmark.`}</p>}
    <details className="mt-3 text-sm"><summary className="cursor-pointer py-2">What these numbers mean</summary><p>Uses the same saved lecture, homework, exam and outside-practice answers as Practice Pulse. Retakes count; mirrored saves count once. Count-only entries increase volume but not accuracy.</p><p>Practice accuracy is not a predicted school-exam grade. Coverage requires linked answer evidence.</p></details>
    <SchoolAlignmentPanel blockId={blockId} userId={userId} sessions={history.sessions} historyReady={!history.loading&&!history.error}/>
  </section>;
}
