/**
 * Task 10 — Tutor mode panel: presentational only.
 *
 * A "Tutor breakdown" panel visually distinct from, and positioned
 * separately from, ExamSessionRunner.jsx's existing right/wrong explanation
 * block. This component does NOT wire itself in there, does NOT read
 * `readTutorModeEnabled()`, and does NOT call `useTutorExplanation` itself —
 * a later task (Task 12) mounts it, conditioned on the preference, and wires
 * `onRequest`/`text`/`loading`/`error` through from the hook.
 */
import { Button } from "../../../ui/Button.jsx";

export function TutorPanel({ question, onRequest, text, loading, error }) {
  const hasRequested = loading || error != null || text != null;

  return (
    <div
      data-testid="tutor-panel"
      className="rounded-lg border border-accent/40 bg-bg-elevated p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="font-mono text-[12px] uppercase tracking-wider text-accent-text">
          Tutor breakdown
        </div>
        {!hasRequested && (
          <Button
            variant="outline"
            disabled={!question}
            onClick={() => onRequest?.()}
          >
            Explain this question
          </Button>
        )}
      </div>

      {loading && (
        <div data-testid="tutor-panel-loading" className="text-xs text-text-3">
          Working out how to parse this one…
        </div>
      )}

      {!loading && error != null && (
        <div data-testid="tutor-panel-error" className="text-xs text-text-3">
          Couldn't load a breakdown right now.
        </div>
      )}

      {!loading && error == null && text != null && (
        <div data-testid="tutor-panel-text" className="text-[13px] leading-relaxed text-text-2">
          {text}
        </div>
      )}
    </div>
  );
}
