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
import { listExamSessions } from "../../../supabase.js";
import { read as readWeakConcepts } from "../../../stores/weakConcepts.js";
import { evaluateSessionForLecture } from "./finalizeLogic.js";

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

export function ExamDashboard({ blockId, userId, lecturesById, onNavigateToLecture }) {
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState([]);
  // I7 fix — `listExamSessions(...).then(...)` had no rejection handler: a
  // fetch failure left "Loading…" up forever (plus an unhandled rejection).
  const [error, setError] = useState(null);

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
        .sort((a, b) => a.label.localeCompare(b.label)),
    [lectureStats, lecturesById, weakLectureIds]
  );

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
    <div className="p-5">
      <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-text-3">
        Integrated Exam performance
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-border p-3 text-xs text-text-3">
          No Integrated Exam attempts yet for this block.
        </div>
      ) : (
        <div className="rounded-lg border border-border px-3">
          {rows.map((row) => (
            <div
              key={row.lectureId}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-1.5 last:border-b-0"
            >
              <span className="text-sm text-text-1">
                {row.label}
                {row.weak && (
                  <button
                    type="button"
                    onClick={() => onNavigateToLecture(row.lectureId)}
                    className="ml-2 font-mono text-[12px] text-bad underline"
                    title="flagged struggling from Integrated Exam performance"
                  >
                    ⚠ weak
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
        </div>
      )}
    </div>
  );
}

export default ExamDashboard;
