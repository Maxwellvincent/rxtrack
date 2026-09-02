import { useEffect, useMemo, useState } from "react";
import { listExamSessions } from "../../../supabase.js";
import * as calibrationStore from "../../../stores/calibrationByBlock.js";
import { retrievalStore } from "../../../stores/modelRetrieval.js";
import { useLectures } from "../../hooks/useLectures.js";
import { useLectureQuestionStats } from "../../hooks/useLectureQuestionStats.js";
import { useObjectives } from "../../hooks/useObjectives.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { useWeakConcepts } from "../../hooks/useWeakConcepts.js";
import { blockReadinessSummary } from "./blockReadiness.js";

const pct = (value) => value == null ? "—" : `${Math.round(value * 100)}%`;

function Metric({ label, value, detail }) {
  return <div className="rounded-lg border border-border bg-panel p-3">
    <div className="font-mono text-[11px] uppercase tracking-wide text-text-3">{label}</div>
    <div className="mt-1 text-xl font-bold text-text-1">{value}</div>
    <div className="mt-1 text-xs text-text-2">{detail}</div>
  </div>;
}

export function BlockReadinessDashboard({ blockId, userId, onStudyLecture }) {
  const lectures = useLectures(blockId, userId);
  const objectives = useObjectives(blockId, userId);
  const questionStats = useLectureQuestionStats(userId);
  const weakConcepts = useWeakConcepts(blockId, userId);
  const retrieval = useStoreResource(retrievalStore, userId);
  const calibration = useStoreResource(calibrationStore, userId);
  const [sessionState, setSessionState] = useState({ key: null, sessions: [], error: false });
  const [refresh, setRefresh] = useState(0);

  const requestKey = `${userId || "local"}:${blockId}:${refresh}`;

  useEffect(() => {
    let active = true;
    listExamSessions(userId, blockId).then((rows) => {
      if (!active) return;
      setSessionState({ key: requestKey, sessions: rows || [], error: false });
    }).catch(() => {
      if (active) setSessionState({ key: requestKey, sessions: [], error: true });
    });
    return () => { active = false; };
  }, [userId, blockId, requestKey]);

  const confidenceRecords = useMemo(
    () => Array.isArray(calibration.data?.[blockId]) ? calibration.data[blockId] : [],
    [calibration.data, blockId]
  );
  const sessions = useMemo(
    () => sessionState.key === requestKey ? sessionState.sessions : [],
    [sessionState, requestKey]
  );

  const result = useMemo(() => blockReadinessSummary({
    blockId,
    lectures: lectures.data || [],
    objectives: objectives.data || [],
    questionStats: questionStats.data || {},
    sessions,
    confidenceRecords,
    models: Object.values(retrieval.data?.models || {}),
    weakConcepts: weakConcepts.data || [],
  }), [blockId, lectures.data, objectives.data, questionStats.data, sessions, confidenceRecords, retrieval.data, weakConcepts.data]);

  const loading = lectures.loading || objectives.loading || questionStats.loading || weakConcepts.loading || retrieval.loading || calibration.loading || sessionState.key !== requestKey;
  const partial = lectures.error || objectives.error || questionStats.error || weakConcepts.error || retrieval.error || calibration.error || sessionState.error;
  const trendDetail = result.trend.delta == null ? "Needs more rated answers" : `${result.trend.delta >= 0 ? "+" : ""}${Math.round(result.trend.delta * 100)} points vs prior 20`;
  const confidenceDetail = result.confidence.highCount < 10
    ? `${result.confidence.highCount} high-confidence answers recorded`
    : `${result.confidence.landmines} confident miss${result.confidence.landmines === 1 ? "" : "es"}`;

  return <section aria-label="Block readiness dashboard" className="rounded-xl border border-border bg-bg-elevated p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-3">Block readiness</div>
        <h2 className="mt-1 text-xl font-bold text-text-1">{loading ? "Syncing your study picture…" : result.state}</h2>
        <p className="mt-1 text-sm text-text-2">A study-direction summary, not a predicted school-exam score.</p>
      </div>
      <button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)} className="min-h-11 rounded-lg border border-border px-3 text-sm font-semibold text-text-2 hover:border-border-strong disabled:opacity-50">
        {loading ? "Syncing…" : "Refresh"}
      </button>
    </div>

    {partial && <p role="alert" className="mt-3 rounded-lg border border-border p-2 text-sm text-text-2">Some records could not sync. The dashboard is showing the information currently available.</p>}

    <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
      <Metric label="Objective coverage" value={loading ? "—" : pct(result.objectives.coverage)} detail={loading ? "Loading objectives" : `${result.objectives.covered}/${result.objectives.total} tested or rated`} />
      <Metric label="Questions" value={loading ? "—" : result.practice.answered.toLocaleString()} detail={loading ? "Loading practice" : `${pct(result.practice.accuracy)} overall accuracy`} />
      <Metric label="Confidence" value={loading ? "—" : pct(result.confidence.highAccuracy)} detail={loading ? "Loading calibration" : confidenceDetail} />
      <Metric label="Direction" value={loading ? "—" : result.trend.label} detail={loading ? "Loading trend" : trendDetail} />
      <Metric label="Mental models due" value={loading ? "—" : String(result.models.overdue)} detail={loading ? "Loading models" : result.models.total ? `${result.models.total} enrolled in this block` : "No models enrolled yet"} />
    </div>

    {!loading && <div className="mt-4 rounded-lg border border-border bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-text-1">Study next</h3>
        <span className="font-mono text-[11px] text-text-3">Top 3 from objectives, questions, exams, and model retrieval</span>
      </div>
      {result.targets.length ? <ol className="mt-2 divide-y divide-border">
        {result.targets.map((target, index) => <li key={target.lectureId} className="flex flex-wrap items-center gap-3 py-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border font-mono text-xs font-bold">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-text-1">{target.title}</div>
            <div className="text-xs text-text-2">{target.reasons.join(" · ")}</div>
          </div>
          {onStudyLecture && <button type="button" onClick={() => onStudyLecture(target.lectureId)} className="min-h-11 rounded-lg border-2 border-border-strong px-3 text-sm font-bold hover:border-accent">Study →</button>}
        </li>)}
      </ol> : <p className="mt-2 text-sm text-text-2">No priority repair target is available yet. Complete a quiz or rate objectives to establish the next focus.</p>}
    </div>}

    <details className="mt-3 text-sm text-text-2">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">How readiness is determined</summary>
      <p>Coverage counts objectives that are no longer untested. Question volume includes recorded lecture, objective, homework, school-bank, and integrated-exam answers while excluding unanswered items. Confidence is the accuracy of answers rated Confident or Certain. Study-next ranking prioritizes struggling objectives, sub-benchmark practice, exam repair flags, and due mental models.</p>
    </details>
  </section>;
}
