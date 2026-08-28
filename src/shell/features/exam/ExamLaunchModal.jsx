import { useEffect, useState } from "react";

// A full school-prep sitting can now reach 100 questions. Keeping the cap here
// (rather than accepting an arbitrary number) still protects the generation
// path from accidental, very expensive launches.
const MAX_QUESTION_COUNT = 100;

export function examBlueprint(eligibleLectures = [], questionCount = 0) {
  const lectures = (eligibleLectures || []).filter((l) => l?.lectureId);
  const objectiveCount = lectures.reduce((sum, l) => sum + (l.objectiveCount || 0), 0);
  return {
    lectureCount: lectures.length,
    objectiveCount,
    guaranteedLectureCoverage: Math.min(lectures.length, questionCount),
    objectiveSamplingCapacity: Math.min(objectiveCount, questionCount),
  };
}

/**
 * Presentational config modal shown before launching an Integrated Exam
 * session. Collects format/count/duration and does the simple "zero
 * eligible lectures" feasibility check inline — it does NOT call
 * generation or session-creation code itself; that's `launchExam.js`'s
 * job (Part B), invoked by the caller via `onLaunch`.
 *
 * Props:
 *   blockId              string
 *   userId               string
 *   eligibleLectures     [{lectureId, lectureLabel, objectiveCount}]
 *   defaultQuestionCount number — pre-resolved by the parent
 *   onLaunch({ format, questionCount, durationMinutes }) => void
 *   onCancel () => void
 *   launching             bool — Task 12's fix for a double-launch race:
 *     while true, both buttons are disabled and Start reads "Starting…" so a
 *     second click during the (multi-second, real-AI-cost) generation call
 *     can't fire a second launch.
 */
export function ExamLaunchModal({
  blockId,
  userId,
  eligibleLectures = [],
  defaultQuestionCount,
  onLaunch,
  onCancel,
  launching = false,
  progress = null,
  error = null,
  onPrepare,
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!launching) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [launching]);
  const [format, setFormat] = useState("exam");
  const [count, setCount] = useState(String(defaultQuestionCount || 20));
  // Auto-calculated from question count (1.5 min/question, matching real
  // exam pacing) until the user types into the duration field themselves —
  // then their value sticks and stops following count changes.
  const [duration, setDuration] = useState(() =>
    String(Math.round((defaultQuestionCount || 20) * 1.5))
  );
  const [durationTouched, setDurationTouched] = useState(false);

  const noLectures = !eligibleLectures || eligibleLectures.length === 0;

  const parsedCount = Math.max(1, Math.min(MAX_QUESTION_COUNT, parseInt(count, 10) || 1));
  const parsedDuration = parseInt(duration, 10);
  const durationValid = format !== "exam" || (Number.isFinite(parsedDuration) && parsedDuration > 0);

  const canLaunch = !noLectures && durationValid;
  const blueprint = examBlueprint(eligibleLectures, parsedCount);

  const handleCountChange = (e) => {
    const raw = e.target.value;
    if (raw === "") {
      setCount("");
      return;
    }
    const n = Math.max(1, Math.min(MAX_QUESTION_COUNT, parseInt(raw, 10) || 1));
    setCount(String(n));
    if (!durationTouched) setDuration(String(Math.round(n * 1.5)));
  };

  const handleDurationChange = (e) => {
    setDurationTouched(true);
    setDuration(e.target.value);
  };

  const handleLaunch = () => {
    if (!canLaunch) return;
    onLaunch({
      format,
      questionCount: parsedCount,
      durationMinutes: format === "exam" ? parsedDuration : null,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Exam settings"
      onClick={(e) => { if (!launching && e.target === e.currentTarget) onCancel?.(); }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-1">Exam settings</h2>
          <button onClick={onCancel} disabled={launching} aria-label="Close exam settings" className="font-mono text-xs text-text-3 hover:text-text-1 disabled:opacity-40">✕</button>
        </div>

        <fieldset disabled={launching} className="flex flex-col gap-4">
          {/* Format */}
          <div>
            <div className="mb-1 font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">Format</div>
            <div className="flex gap-1.5">
              {[
                { value: "exam", label: "Exam conditions" },
                { value: "practice", label: "Practice" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFormat(opt.value)}
                  className={[
                    "rounded border px-2.5 py-1 font-mono text-[13px] transition-colors",
                    format === opt.value
                      ? "border-accent bg-panel text-text-1"
                      : "border-border text-text-3 hover:border-border-strong hover:text-text-2",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {!noLectures && (
              <div className="mt-2 rounded border border-border bg-panel p-2.5 font-mono text-[12px] leading-relaxed text-text-2">
                <div className="font-bold text-text-1">Objective blueprint</div>
                <div>{blueprint.objectiveCount} objectives across {blueprint.lectureCount} lectures</div>
                <div>
                  Planned lecture coverage: {blueprint.guaranteedLectureCoverage}/{blueprint.lectureCount}
                  {" · "}up to {blueprint.objectiveSamplingCapacity} objective slots
                </div>
                <div className="text-text-3">Weak and untested objectives receive extra allocation.</div>
              </div>
            )}
          </div>

          {/* Question count */}
          <div>
            <label className="mb-1 block font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">
              Questions
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max={MAX_QUESTION_COUNT}
                value={count}
                onChange={handleCountChange}
                className="w-20 rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-sm text-text-1 focus:border-border-strong focus:outline-none"
              />
              <span className="font-mono text-[12px] text-text-3">max {MAX_QUESTION_COUNT}</span>
            </div>
          </div>

          {/* Duration — exam format only */}
          {format === "exam" && (
            <div>
              <label className="mb-1 block font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">
                Duration (minutes)
              </label>
              <input
                type="number"
                min="1"
                value={duration}
                onChange={handleDurationChange}
                placeholder="Required"
                className="w-24 rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-sm text-text-1 focus:border-border-strong focus:outline-none"
              />
              {!durationTouched && (
                <div className="mt-1 font-mono text-[11px] text-text-3">
                  1.5 min/question — edit to override
                </div>
              )}
            </div>
          )}

          {/* Feasibility */}
          {noLectures && (
            <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2.5 font-mono text-[12px] text-text-3">
              No lectures in this block have objectives yet — nothing to build an exam from.
            </div>
          )}
        </fieldset>

        {launching && (
          <div role="status" className="mt-4 rounded-lg border border-accent bg-panel p-3 text-sm text-text-1">
            <div className="flex items-center gap-2"><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />Preparing your exam · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</div>
            <div className="mt-2">{progress?.message || "Preparing questions…"}</div>
            {progress?.total > 0 && <><progress aria-label="Questions prepared" className="mt-2 w-full" value={progress.completed || 0} max={progress.total} /><div>{progress.completed || 0}/{progress.total} questions prepared</div></>}
            <div className="mt-2 text-xs text-text-2">Uses saved questions first, then generates up to two lectures at once. Completed questions are saved. Keep this tab open.</div>
          </div>
        )}
        {!launching && error && <div role="alert" className="mt-4 rounded-lg border border-bad p-3 text-sm text-text-1">{error}</div>}

        {onPrepare && <div className="mt-4 border-t border-border pt-3 text-sm text-text-2">
          <button type="button" disabled={!canLaunch || launching} onClick={() => onPrepare({ format, questionCount: parsedCount, durationMinutes: format === "exam" ? parsedDuration : null })}
            className="rounded border border-border px-3 py-2 font-semibold text-text-1 disabled:opacity-40">Prepare questions for later</button>
          <p className="mt-2 text-xs">Saves unused questions privately in Firestore. You can switch tabs within RXtrack while it runs; keep the website open. No exam timer or score is started.</p>
        </div>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={launching}
            className="rounded border border-border px-3 py-1.5 font-mono text-xs text-text-2 hover:text-text-1 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={!canLaunch || launching}
            className="rounded bg-accent px-3 py-1.5 font-mono text-xs font-bold text-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {launching ? "Starting…" : "Start exam"}
          </button>
        </div>
      </div>
    </div>
  );
}
