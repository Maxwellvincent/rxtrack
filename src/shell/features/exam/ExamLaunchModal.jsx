import { useState } from "react";

const MAX_QUESTION_COUNT = 50;

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
}) {
  const [format, setFormat] = useState("exam");
  const [count, setCount] = useState(String(defaultQuestionCount || 20));
  const [duration, setDuration] = useState("");

  const noLectures = !eligibleLectures || eligibleLectures.length === 0;

  const parsedCount = Math.max(1, Math.min(MAX_QUESTION_COUNT, parseInt(count, 10) || 1));
  const parsedDuration = parseInt(duration, 10);
  const durationValid = format !== "exam" || (Number.isFinite(parsedDuration) && parsedDuration > 0);

  const canLaunch = !noLectures && durationValid;

  const handleCountChange = (e) => {
    const raw = e.target.value;
    if (raw === "") {
      setCount("");
      return;
    }
    const n = Math.max(1, Math.min(MAX_QUESTION_COUNT, parseInt(raw, 10) || 1));
    setCount(String(n));
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-14"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-1">Exam settings</h2>
          <button onClick={onCancel} className="font-mono text-xs text-text-3 hover:text-text-1">✕</button>
        </div>

        <div className="flex flex-col gap-4">
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
                onChange={(e) => setDuration(e.target.value)}
                placeholder="Required"
                className="w-24 rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-sm text-text-1 focus:border-border-strong focus:outline-none"
              />
            </div>
          )}

          {/* Feasibility */}
          {noLectures && (
            <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2.5 font-mono text-[12px] text-text-3">
              No lectures in this block have objectives yet — nothing to build an exam from.
            </div>
          )}
        </div>

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
