import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import * as calibrationStore from "../../../stores/calibrationByBlock.js";
import { listExamSessions } from "../../../supabase.js";
import { questionProgress } from "../exam/questionProgress.js";

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DailyQuestionScore({ userId, blockId }) {
  // readBlock may deserialize localStorage data or manufacture a new empty
  // array on each call. useSyncExternalStore requires a cached snapshot, so
  // compare a stable serialized value and only parse when that value changes.
  const studyAnswersSnapshot = useSyncExternalStore(
    (callback) => calibrationStore.subscribe(callback),
    () => JSON.stringify(calibrationStore.readBlock(userId, blockId)),
    () => JSON.stringify(calibrationStore.readBlock(userId, blockId))
  );
  const studyAnswers = useMemo(() => {
    try { return JSON.parse(studyAnswersSnapshot || "[]"); }
    catch { return []; }
  }, [studyAnswersSnapshot]);
  const [loadResult, setLoadResult] = useState(null);
  const queryKey = `${userId || "local"}:${blockId}`;
  const loading = loadResult?.key !== queryKey;
  const error = !loading && loadResult.error;
  const sessions = !loading && !error ? loadResult.sessions : [];
  const today = localDateKey();

  useEffect(() => {
    let cancelled = false;
    listExamSessions(userId, blockId, { status: "submitted" })
      .then((rows) => { if (!cancelled) setLoadResult({ key: queryKey, sessions: rows || [], error: false }); })
      .catch(() => { if (!cancelled) setLoadResult({ key: queryKey, sessions: [], error: true }); });
    return () => { cancelled = true; };
  }, [userId, blockId, queryKey]);

  const progress = questionProgress(studyAnswers, sessions, { start: today, end: today });
  const accuracy = progress.accuracy == null ? null : Math.round(progress.accuracy * 100);
  const atTarget = accuracy != null && accuracy >= 80;

  return <section aria-label="Daily question score" className="rounded-xl border border-border bg-bg-elevated p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold text-text-1">Today’s question score</h3>
        <p className="mt-1 text-sm text-text-2">{loading ? "Loading today’s graded answers…" : error ? "Could not load today’s exam results." : accuracy == null ? "No graded questions completed in RXTrack today yet." : `${progress.gradedAnswered} graded question${progress.gradedAnswered === 1 ? "" : "s"} · ${progress.correct} correct · ${accuracy}% average`}</p>
      </div>
      <div className={`rounded-lg border px-3 py-2 text-sm font-semibold ${atTarget ? "border-good/40 bg-good/10 text-good" : "border-border bg-panel text-text-2"}`}>
        {atTarget ? "80% goal reached" : "Daily target · 80%"}
      </div>
    </div>
    {accuracy != null && <>
      <progress className={`mt-3 h-3 w-full accent-accent ${atTarget ? "[&::-webkit-progress-value]:bg-good" : ""}`} max={100} value={accuracy} aria-label={`Daily accuracy ${accuracy}%`} />
      <p className="mt-1 text-xs text-text-3">{atTarget ? "You’re at or above your success target for today." : `${80 - accuracy} percentage points to today’s target. Only graded in-app answers count toward this score.`}</p>
    </>}
    {accuracy == null && <p className="mt-2 text-xs text-text-3">Only graded in-app answers count toward the average; manually logged outside practice still counts toward your question-volume goal.</p>}
  </section>;
}
