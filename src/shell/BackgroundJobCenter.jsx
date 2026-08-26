import { useSyncExternalStore } from "react";
import { dismissBackgroundJob, readBackgroundJobs, subscribeBackgroundJobs } from "./backgroundJobs.js";

let snapshot = "[]";
let snapshotJobs = [];
function getSnapshot() {
  const jobs = readBackgroundJobs();
  const next = JSON.stringify(jobs);
  if (next !== snapshot) { snapshot = next; snapshotJobs = jobs; }
  return snapshotJobs;
}

export function BackgroundJobCenter() {
  const jobs = useSyncExternalStore(subscribeBackgroundJobs, getSnapshot, getSnapshot);
  if (!jobs.length) return null;
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-[70] w-[min(24rem,calc(100vw-2rem))] space-y-2">
      {jobs.map((job) => (
        <div key={job.id} className="rounded-lg border border-border bg-bg p-3 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-bold text-text-1">
                {job.status === "running" ? "◌ " : job.status === "done" ? "✓ " : "⚠ "}{job.label}
              </div>
              <div className={`mt-1 font-mono text-[12px] ${job.status === "error" ? "text-bad" : job.status === "done" ? "text-good" : "text-text-3"}`}>
                {job.detail || "Starting…"}
              </div>
            </div>
            {job.status !== "running" && (
              <button onClick={() => dismissBackgroundJob(job.id)} aria-label="Dismiss notification" className="text-xs text-text-3">✕</button>
            )}
          </div>
          {job.status === "running" && <div className="mt-2 h-1 overflow-hidden rounded bg-panel"><div className="h-full w-1/2 animate-pulse rounded bg-accent" /></div>}
        </div>
      ))}
    </div>
  );
}
