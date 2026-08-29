/**
 * Task 9 — read-only per-lecture Integrated Exam performance dashboard.
 *
 * Derived exclusively from submitted `examSessions` (never
 * `lectureQuestionStats`, which mixes exam and ordinary Quiz-mode answers
 * and can't isolate an Integrated-Exam-only view). Block-scoped only — no
 * "everything" toggle, unlike WeakConcepts.jsx, whose scope-toggle UI this
 * component deliberately does not copy.
 */
import { useEffect, useMemo, useState } from "react";
import { deleteExamSession, listExamSessions } from "../../../supabase.js";
import { releaseSessionQuestions } from "../../../questionPool.js";
import { read as readWeakConcepts } from "../../../stores/weakConcepts.js";
import { evaluateSessionForLecture } from "./finalizeLogic.js";
import * as learnerEvidenceStore from "../../../stores/learnerEvidence.js";
import { ERROR_REASONS } from "./questionReading.js";

/**
 * Per-lecture `{totalQuestions, totalMisses, accuracy}` summed across every
 * submitted session, for every lectureId that appears in any session's
 * `questions` array.
 */
function computeLectureStats(sessions) {
  const lectureIds = new Set();
  for (const session of sessions || []) {
    for (const q of session?.questions || []) {
      if (q.lectureId) lectureIds.add(q.lectureId);
    }
  }

  const stats = {};
  for (const lectureId of lectureIds) {
    let totalQuestions = 0;
    let totalMisses = 0;
    for (const session of sessions) {
      const { questionCount, misses } = evaluateSessionForLecture(session, lectureId);
      totalQuestions += questionCount;
      totalMisses += misses;
    }
    stats[lectureId] = {
      totalQuestions,
      totalMisses,
      accuracy: totalQuestions ? 1 - totalMisses / totalQuestions : null,
    };
  }
  return stats;
}

/**
 * `lectureId`s flagged struggling by Task 7's finalization, per this block.
 * Prefers `linkedLecIds[0]` over parsing the `id` suffix — that's the field
 * Task 7's write path (`examReportWeakConcepts.js`) built specifically for
 * this lookup, though both should agree given `id: exam:<blockId>:<lectureId>`.
 */
function computeWeakLectureIds(weakConceptsForBlock, blockId) {
  const prefix = `exam:${blockId}:`;
  const ids = new Set();
  for (const entry of weakConceptsForBlock || []) {
    if (!entry || typeof entry.id !== "string" || !entry.id.startsWith(prefix)) continue;
    if (entry.masteryLevel !== "struggling") continue;
    const lectureId = entry.linkedLecIds?.[0] ?? entry.id.slice(prefix.length);
    if (lectureId) ids.add(lectureId);
  }
  return ids;
}

function accuracyClass(accuracy) {
  if (accuracy === null) return "text-text-3";
  if (accuracy < 0.6) return "text-bad";
  if (accuracy < 0.8) return "text-text-2";
  return "text-good";
}

export function computeObjectiveReadiness(sessions, objectives = []) {
  const knownIds = new Set((objectives || []).map((o) => o?.id).filter(Boolean));
  const stats = {};
  for (const session of sessions || []) {
    for (const question of session?.questions || []) {
      const answer = (session.answers || []).find((a) => a.questionId === question.questionId);
      if (!answer) continue;
      const correct = !!answer && answer.value === question.correct;
      for (const objectiveId of question.objectiveIds || []) {
        if (knownIds.size && !knownIds.has(objectiveId)) continue;
        const prev = stats[objectiveId] || { attempts: 0, correct: 0 };
        stats[objectiveId] = { attempts: prev.attempts + 1, correct: prev.correct + (correct ? 1 : 0) };
      }
    }
  }
  const testedIds = Object.keys(stats);
  const total = knownIds.size || testedIds.length;
  const attempts = testedIds.reduce((sum, id) => sum + stats[id].attempts, 0);
  const correct = testedIds.reduce((sum, id) => sum + stats[id].correct, 0);
  const ready = testedIds.filter((id) => stats[id].attempts >= 2 && stats[id].correct / stats[id].attempts >= 0.8).length;
  const weak = testedIds.filter((id) => stats[id].attempts >= 2 && stats[id].correct / stats[id].attempts < 0.6).length;
  return {
    tested: testedIds.length,
    total,
    coverage: total ? testedIds.length / total : 0,
    accuracy: attempts ? correct / attempts : null,
    ready,
    weak,
    stats,
  };
}

export function computePacingMetrics(sessions = []) {
  let totalQuestions = 0;
  let unanswered = 0;
  let elapsedMs = 0;
  const quarters = Array.from({ length: 4 }, () => ({ questions: 0, correct: 0 }));
  for (const session of sessions || []) {
    const questions = session?.questions || [];
    const answers = new Map((session?.answers || []).map((a) => [a.questionId, a]));
    totalQuestions += answers.size;
    unanswered += questions.filter((q) => !answers.has(q.questionId)).length;
    if (Number.isFinite(session?.startedAt) && Number.isFinite(session?.submittedAt)) {
      elapsedMs += Math.max(0, session.submittedAt - session.startedAt);
    }
    questions.forEach((q, index) => {
      const quarter = Math.min(3, Math.floor((index * 4) / Math.max(questions.length, 1)));
      const answer = answers.get(q.questionId);
      if (!answer) return;
      quarters[quarter].questions++;
      if (answer?.value === q.correct) quarters[quarter].correct++;
    });
  }
  return {
    totalQuestions,
    unanswered,
    secondsPerQuestion: totalQuestions && elapsedMs ? elapsedMs / 1000 / totalQuestions : null,
    quarters: quarters.map((q) => ({ ...q, accuracy: q.questions ? q.correct / q.questions : null })),
  };
}

export function ExamDashboard({ blockId, userId, lecturesById, objectives = [], onNavigateToLecture, onReviewSession }) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  // I7 fix — `listExamSessions(...).then(...)` had no rejection handler: a
  // fetch failure left "Loading…" up forever (plus an unhandled rejection).
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [learnerProfile, setLearnerProfile] = useState(() => learnerEvidenceStore.read(userId));

  useEffect(() => {
    setLearnerProfile(learnerEvidenceStore.read(userId));
    return learnerEvidenceStore.subscribe(() => setLearnerProfile(learnerEvidenceStore.read(userId)));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listExamSessions(userId, blockId, { status: "submitted" })
      .then((submitted) => {
        if (cancelled) return;
        setSessions(submitted || []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, blockId]);

  const lectureStats = useMemo(() => computeLectureStats(sessions), [sessions]);

  const weakLectureIds = useMemo(() => {
    const forBlock = readWeakConcepts(userId)?.[blockId] || [];
    return computeWeakLectureIds(forBlock, blockId);
  }, [userId, blockId, sessions]);

  const rows = useMemo(
    () =>
      Object.entries(lectureStats)
        .map(([lectureId, stat]) => ({
          lectureId,
          label: lecturesById?.[lectureId]?.lectureTitle || lectureId,
          ...stat,
          weak: weakLectureIds.has(lectureId),
        }))
        .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1) || b.totalQuestions - a.totalQuestions || a.label.localeCompare(b.label)),
    [lectureStats, lecturesById, weakLectureIds]
  );
  const readiness = useMemo(() => computeObjectiveReadiness(sessions, objectives), [sessions, objectives]);
  const pacing = useMemo(() => computePacingMetrics(sessions), [sessions]);
  const process = learnerProfile?.testTaking || {};
  const reasonRows = useMemo(() =>
    ERROR_REASONS
      .map(([id, label]) => ({ id, label, count: process.reasons?.[id] || 0 }))
      .filter((row) => row.count > 0)
      .sort((a, b) => b.count - a.count),
  [process.reasons]);
  const taskRows = useMemo(() => Object.entries(learnerProfile?.taskTypes || {})
    .map(([id, stat]) => ({ id, ...stat, accuracy: stat.attempts ? stat.correct / stat.attempts : null }))
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1)), [learnerProfile?.taskTypes]);

  if (loading) {
    return (
      <div className="p-5">
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-3">
          Integrated Exam performance
        </div>
        <div className="rounded-lg border border-border p-3 text-xs text-text-3">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5">
        <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-3">
          Integrated Exam performance
        </div>
        <div data-testid="exam-dashboard-error" className="rounded-lg border border-bad/40 p-3 text-xs text-bad">
          Could not load Integrated Exam performance: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="desk-exam-dashboard p-1 sm:p-2">
      <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-3">
        Integrated Exam performance
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Step 1 readiness summary">
        {[
          ["Objective coverage", `${Math.round(readiness.coverage * 100)}%`],
          ["Exam accuracy", readiness.accuracy === null ? "—" : `${Math.round(readiness.accuracy * 100)}%`],
          ["Ready objectives", String(readiness.ready)],
          ["Weak objectives", String(readiness.weak)],
        ].map(([label, value]) => (
          <div key={label} className="desk-metric-card rounded-xl border border-border bg-panel p-4">
            <div className="font-mono text-[12px] text-text-3">{label}</div>
            <div className="mt-1 text-xl font-bold text-text-1">{value}</div>
          </div>
        ))}
      </div>

      {pacing.totalQuestions > 0 && (
        <details className="mb-4 rounded-lg border border-border p-3" aria-label="Exam pacing report">
          <summary className="cursor-pointer font-mono text-[12px] font-bold uppercase tracking-wider text-text-2">Pacing details · {pacing.secondsPerQuestion === null ? "time unavailable" : `${Math.round(pacing.secondsPerQuestion)} sec/question`}</summary>
          <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-mono text-[12px] font-bold uppercase tracking-wider text-text-2">Pacing</div>
            <div className="font-mono text-[12px] text-text-3">
              {pacing.secondsPerQuestion === null ? "time unavailable" : `${Math.round(pacing.secondsPerQuestion)} sec/question`}
              {" · "}{pacing.unanswered} unanswered
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {pacing.quarters.map((quarter, index) => (
              <div key={index} className="rounded bg-panel p-2 text-center">
                <div className="font-mono text-[11px] text-text-3">Q{index + 1}</div>
                <div className={`text-sm font-bold ${accuracyClass(quarter.accuracy)}`}>
                  {quarter.accuracy === null ? "—" : `${Math.round(quarter.accuracy * 100)}%`}
                </div>
              </div>
            ))}
          </div>
          </div>
        </details>
      )}

      {(process.timedAnswers > 0 || reasonRows.length > 0) && (
        <details className="mb-4 rounded-lg border border-border p-3" aria-label="Test-taking diagnostics">
          <summary className="cursor-pointer font-mono text-[12px] font-bold uppercase tracking-wider text-text-2">Test-taking diagnostics</summary>
          <div className="mt-3">
          <div className="font-mono text-[12px] font-bold uppercase tracking-wider text-text-2">Test-taking diagnostics</div>
          {reasonRows.length > 0 && <div className="mt-1 text-xs text-text-3">These are the reasons you selected after missed questions. “Knowledge gap” means you marked that the tested fact or mechanism was not yet secure—not that RXtrack inferred it automatically.</div>}
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[12px] text-text-3">
            {process.timedAnswers > 0 && (
              <span className="rounded bg-panel px-2 py-1">
                avg commit time {Math.round(process.totalResponseMs / process.timedAnswers / 1000)} sec
              </span>
            )}
            <span className="rounded bg-panel px-2 py-1">{process.answerChanges || 0} answer changes</span>
          </div>
          {reasonRows.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {reasonRows.map((row) => {
                const total = reasonRows.reduce((sum, item) => sum + item.count, 0);
                return (
                  <div key={row.id} className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-2 text-[13px]">
                    <div>
                      <div className="mb-1 flex justify-between text-text-2"><span>{row.label}</span><span>{row.count}</span></div>
                      <div className="h-1.5 overflow-hidden rounded bg-panel"><div className="h-full bg-accent" style={{ width: `${(row.count / total) * 100}%` }} /></div>
                    </div>
                    <div className="text-right font-mono text-[11px] text-text-3">{Math.round((row.count / total) * 100)}%</div>
                  </div>
                );
              })}
            </div>
          )}
          {taskRows.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="mb-1 font-mono text-[11px] uppercase tracking-wider text-text-3">Accuracy by what the lead-in asks</div>
              {taskRows.map((row) => (
                <div key={row.id} className="flex justify-between py-0.5 text-[13px] text-text-2">
                  <span>{row.id.replace(/-/g, " ")}</span>
                  <span className={`font-mono ${accuracyClass(row.accuracy)}`}>{row.attempts} q · {Math.round(row.accuracy * 100)}%</span>
                </div>
              ))}
            </div>
          )}
          </div>
        </details>
      )}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border p-3 text-xs text-text-3">
          No Integrated Exam attempts yet for this block.
        </div>
      ) : (
        <details className="rounded-lg border border-border px-3" open>
          <summary className="cursor-pointer py-3 font-mono text-[12px] font-bold uppercase tracking-wider text-text-2">Weakest lectures first · mental-model repair</summary>
          {rows.map((row) => (
            <div
              key={row.lectureId}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1.5 last:border-b-0"
            >
              <span className="text-sm text-text-1">
                {row.label}
                {(row.weak || (row.accuracy !== null && row.accuracy < 0.6)) && (
                  <button
                    type="button"
                    onClick={() => onNavigateToLecture(row.lectureId)}
                    className="ml-2 font-mono text-[12px] text-bad underline"
                    title="flagged struggling from Integrated Exam performance"
                  >
                    ⚠ Repair model
                  </button>
                )}
              </span>
              <span className="font-mono text-[12px] text-text-3">
                {row.totalQuestions} question{row.totalQuestions === 1 ? "" : "s"}
                {" · "}
                <span className={accuracyClass(row.accuracy)}>
                  {row.accuracy === null ? "—" : `${Math.round(row.accuracy * 100)}%`}
                </span>
              </span>
            </div>
          ))}
        </details>
      )}

      {sessions.length > 0 && <details className="mt-4 rounded-lg border border-border px-3"><summary className="cursor-pointer py-3 font-mono text-[12px] font-bold uppercase tracking-wider text-text-2">Saved exam history · {sessions.length}</summary><div className="space-y-2 pb-3">{[...sessions].sort((a,b) => (b.submittedAt || 0) - (a.submittedAt || 0)).map(session => {
        const answered = (session.answers || []).length;
        const correct = (session.questions || []).filter(q => (session.answers || []).find(a => a.questionId === q.questionId)?.value === q.correct).length;
        const score = answered ? Math.round(correct / answered * 100) : 0;
        return <div key={session.sessionId || session.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-panel p-3"><div><div className="text-sm font-bold text-text-1">{score}% · {correct}/{answered} answered correctly</div><div className="font-mono text-[11px] text-text-3">{new Date(session.submittedAt || Date.now()).toLocaleString()} · {(session.questions || []).length - answered} unused</div></div><div className="flex gap-2"><button type="button" className="rounded border-2 border-border px-3 py-1.5 text-xs font-bold" onClick={() => onReviewSession?.(session.sessionId || session.id)}>Review</button><button type="button" disabled={deletingId === (session.sessionId || session.id)} className="rounded border-2 border-bad/60 px-3 py-1.5 text-xs font-bold" onClick={async () => { const id = session.sessionId || session.id; if (!window.confirm("Delete this exam attempt from your integrated-exam statistics? Its questions will return to the reserve.")) return; setDeletingId(id); try { await releaseSessionQuestions(userId, session); await deleteExamSession(userId, id); setSessions(current => current.filter(item => (item.sessionId || item.id) !== id)); } finally { setDeletingId(null); } }}>{deletingId === (session.sessionId || session.id) ? "Deleting…" : "Delete"}</button></div></div>;
      })}</div></details>}
    </div>
  );
}

export default ExamDashboard;
