export function ExamPreparationStatus({ session }) {
  const ready = session.questions?.length || 0;
  const target = Math.max(ready, Number(session.targetQuestionCount) || ready);
  const progress = session.fillProgress || {};
  const checked = Math.max(0, Number(progress.completedLectures) || 0);
  const totalLectures = Math.max(0, Number(progress.totalLectures) || 0);
  const failed = Math.max(0, Number(progress.failedLectures) || 0);
  const stage = String(progress.message || (ready ? "Preparing the remaining questions…" : "Starting question preparation…"));
  return <section role="status" aria-live="polite" className="rounded-lg border border-accent/40 bg-bg-elevated p-4 text-sm text-text-2">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <strong className="text-base text-text-1">{ready}/{target} questions ready</strong>
      <span className="font-mono text-xs text-accent-text">{target ? Math.round(ready / target * 100) : 0}% accepted</span>
    </div>
    <progress className="mt-3 h-2 w-full accent-accent" value={ready} max={Math.max(1, target)} aria-label={`${ready} of ${target} questions ready`} />
    <p className="mt-2 font-medium text-text-1">{stage}</p>
    <p className="mt-1 text-xs text-text-3">Only questions that finish drafting, independent review, and saving count as ready.</p>
    {totalLectures > 0 && <p className="mt-1 text-xs text-text-3">Lecture sources checked: {checked}/{totalLectures}{failed ? ` · ${failed} with a preparation problem` : ""}</p>}
  </section>;
}
