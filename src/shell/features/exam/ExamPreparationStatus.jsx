import { useEffect, useState } from "react";

export function ExamPreparationStatus({ session }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const ready = session.questions?.length || 0;
  const progress = session.fillProgress;
  const elapsed = session.fillStartedAt ? Math.max(0, Math.floor((now-session.fillStartedAt)/1000)) : null;
  const age = progress?.updatedAt ? Math.max(0, Math.floor((now-progress.updatedAt)/1000)) : null;
  return <section role="status" aria-live="polite" className="space-y-2 rounded-lg border border-accent/40 bg-bg-elevated p-4 text-sm text-text-2">
    <p className="font-semibold text-text-1">{ready}/{session.targetQuestionCount || "…"} questions ready</p>
    <progress className="w-full" value={ready} max={session.targetQuestionCount || Math.max(1, ready)} aria-label="Reviewed questions ready" />
    <p>{ready ? "You can answer the ready questions while the remaining questions are prepared." : "Waiting for the first reviewed question. There is nothing to answer yet."}</p>
    {progress?.activeLectures?.length ? <ul className="space-y-1">{progress.activeLectures.map((message, i) => <li key={i}>{message}</li>)}</ul> : <p>{progress?.message || "Detailed progress is not available for this run yet; its current stage cannot be confirmed from this screen."}</p>}
    {!!progress?.totalLectures && <p>{progress.completedLectures}/{progress.totalLectures} lectures checked{progress.failedLectures ? ` · ${progress.failedLectures} lectures have unfilled slots` : ""}</p>}
    <p>{elapsed != null ? `Elapsed: ${Math.floor(elapsed/60)}m ${elapsed%60}s. ` : ""}{age != null ? `Last progress update ${age}s ago.` : ""}</p>
    {age != null && age >= 90 && <p>The current request is taking longer. No new progress has been confirmed; completed network requests do not mean reviewed questions are ready.</p>}
    {session.format === "exam" && <p>The timer starts when preparation finishes.</p>}
    <p>Keep this tab open until preparation finishes.</p>
  </section>;
}
