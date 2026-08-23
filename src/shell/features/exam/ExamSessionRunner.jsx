/**
 * Task 6 — the Integrated Exam session runtime: the presentational half.
 *
 * One component, branching internally on `session.format`, rather than two
 * parallel component trees (the plan explicitly chose one controller / one
 * runner with a format flag).
 *
 * - format "exam": every question reachable without submitting (a jump list
 *   + one-at-a-time main panel), a visible countdown, a manual submit
 *   button, and NO per-question feedback/reveal.
 * - format "practice": one question at a time, immediate reveal + rationale
 *   after each answer, no timer — mirrors AtomQuiz.jsx's visual language
 *   (border-accent / text-text-1 / bg-bg-elevated etc.) without reusing its
 *   JSX.
 *
 * Choice text is always a plain string by the time it reaches this
 * component — Task 5 already filtered table-shaped choices out before a
 * session is ever created.
 */
import { useEffect } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useExamSessionController } from "./useExamSessionController.js";

function formatClock(ms) {
  if (ms == null) return "--:--";
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function pickedFor(session, questionId) {
  return session?.answers?.find((a) => a.questionId === questionId)?.value ?? null;
}

// Small, unobtrusive autosave-status readout — deliberately no more visually
// prominent than the `exam-timer` element it sits next to. "synced" renders
// nothing (the normal case shouldn't shout); "error"/"stopped" is the one
// state where staying silent would actually mislead the user (the whole
// point of this indicator), so it always renders something, just quietly.
function SyncIndicator({ status }) {
  if (status === "pending") {
    return (
      <div data-testid="sync-status" className="font-mono text-[11px] text-text-3">
        saving…
      </div>
    );
  }
  if (status === "error" || status === "stopped") {
    return (
      <div data-testid="sync-status" className="font-mono text-[11px] text-bad">
        not saving
      </div>
    );
  }
  return (
    <div data-testid="sync-status" className="font-mono text-[11px] text-text-3">
      saved
    </div>
  );
}

function ChoiceList({ choices, picked, revealed, correct, onPick }) {
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(choices || {}).map(([letter, text]) => {
        const isPicked = picked === letter;
        const borderCls = !revealed
          ? isPicked
            ? "border-accent"
            : "border-border hover:border-border-strong cursor-pointer"
          : letter === correct
            ? "border-good"
            : isPicked
              ? "border-bad"
              : "border-border opacity-60";
        return (
          <button
            key={letter}
            type="button"
            disabled={revealed}
            onClick={() => onPick(letter)}
            className={
              "flex items-center gap-2 rounded-lg border bg-bg px-3 py-2 text-left text-xs text-text-1 " +
              borderCls
            }
          >
            <span className="font-mono text-text-3">{letter}</span>
            <span>{text}</span>
          </button>
        );
      })}
    </div>
  );
}

function ExamFormat({ controller }) {
  const { session, currentIndex, setCurrentIndex, remainingMs, answerQuestion, submit, submitting } =
    controller;
  const questions = session.questions || [];
  const q = questions[currentIndex];
  const answeredCount = (session.answers || []).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2">
        <div className="font-mono text-[12px] uppercase tracking-wider text-accent-text">
          Exam · {answeredCount}/{questions.length} answered
        </div>
        <div
          data-testid="exam-timer"
          className={
            "font-mono text-sm font-bold " + (remainingMs != null && remainingMs < 60_000 ? "text-bad" : "text-text-1")
          }
        >
          {formatClock(remainingMs)}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {questions.map((question, idx) => {
          const isAnswered = pickedFor(session, question.questionId) != null;
          const isCurrent = idx === currentIndex;
          return (
            <button
              key={question.questionId}
              type="button"
              onClick={() => setCurrentIndex(idx)}
              className={
                "flex h-7 w-7 items-center justify-center rounded border font-mono text-[11px] " +
                (isCurrent
                  ? "border-accent text-text-1"
                  : isAnswered
                    ? "border-border-strong bg-panel text-text-2"
                    : "border-border text-text-3")
              }
            >
              {idx + 1}
            </button>
          );
        })}
      </div>

      {q && (
        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <div className="mb-2 text-sm text-text-1">{q.stem}</div>
          <ChoiceList
            choices={q.choices}
            picked={pickedFor(session, q.questionId)}
            revealed={false}
            onPick={(letter) => answerQuestion(q.questionId, letter)}
          />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          >
            ← Prev
          </Button>
          <Button
            variant="outline"
            disabled={currentIndex >= questions.length - 1}
            onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
          >
            Next →
          </Button>
        </div>
        <Button onClick={() => submit()} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit exam"}
        </Button>
      </div>
    </div>
  );
}

function PracticeFormat({ controller }) {
  const { session, currentIndex, setCurrentIndex, answerQuestion } = controller;
  const questions = session.questions || [];
  const q = questions[currentIndex];
  if (!q) return null;

  const picked = pickedFor(session, q.questionId);
  const revealed = picked != null;
  const isCorrect = revealed && picked === q.correct;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-wider text-accent-text">
        <span>Practice</span>
        <span className="text-text-3">
          {currentIndex + 1}/{questions.length}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-bg-elevated p-3">
        <div className="mb-2 text-sm text-text-1">{q.stem}</div>
        <ChoiceList
          choices={q.choices}
          picked={picked}
          revealed={revealed}
          correct={q.correct}
          onPick={(letter) => answerQuestion(q.questionId, letter)}
        />

        {revealed && (
          <div className="mt-3 space-y-2">
            <div data-testid="practice-reveal" className={"text-xs " + (isCorrect ? "text-good" : "text-bad")}>
              {isCorrect ? "✓ Correct" : "✕ Incorrect"}
            </div>
            {q.explanation && (
              <div className="rounded border-l-2 border-accent bg-panel p-3 text-[13px] leading-relaxed text-text-2">
                {q.explanation}
              </div>
            )}
            <Button
              disabled={currentIndex >= questions.length - 1}
              onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}
            >
              {currentIndex + 1 >= questions.length ? "Last question" : "Next →"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars -- `blockId` is part of the
// documented prop contract (kept small/stable for callers) even though this
// component doesn't need it directly: `sessionId`/`userId` are enough to
// drive the controller, and the session doc itself already carries blockId.
export function ExamSessionRunner({ sessionId, userId, blockId, onExit }) {
  const controller = useExamSessionController(sessionId, userId);
  const { session, loading, error, submit, abandon, submitResult, submitting, syncStatus } = controller;

  // Resume-on-mount: a session left in "finalizing" (a prior submit call was
  // interrupted before completing) shows a distinct "finishing up" state and
  // the component's job — not the hook's — is to call submit() again; safe
  // per Task 7's idempotent/resumable design.
  useEffect(() => {
    if (session?.status === "finalizing") submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per
    // observed "finalizing" transition, not on every submit identity change.
  }, [session?.status]);

  if (loading) return <div className="text-sm text-text-3">Loading session…</div>;
  if (error) return <div className="text-sm text-bad">{error}</div>;
  if (!session) return <div className="text-sm text-text-3">Session not found.</div>;

  if (session.status === "finalizing") {
    // A prior finalize call can fail resumably (network blip, a transient
    // Firestore error mid-loop — see finalize.js) — the mount effect above
    // already retried it once, but that retry can fail too. Without this,
    // `submitResult.resumable` sits unread and the user is stuck on
    // "Finishing up…" forever with a mount effect that never re-fires
    // (its dependency, session.status, never changes out of "finalizing").
    if (submitResult && !submitResult.ok && submitResult.resumable) {
      return (
        <div className="space-y-3">
          <div className="text-sm text-bad">
            Submitting hit a snag: {submitResult.error || "an unknown error"}.
          </div>
          <Button onClick={() => submit()} disabled={submitting}>
            {submitting ? "Retrying…" : "Retry submit"}
          </Button>
        </div>
      );
    }
    return <div className="text-sm text-text-3">Finishing up…</div>;
  }

  if (session.status === "submitted") {
    return (
      <div className="space-y-3">
        <div className="text-sm font-bold text-text-1">Submitted.</div>
        {onExit && <Button onClick={onExit}>Done</Button>}
      </div>
    );
  }

  if (session.status === "abandoned") {
    return (
      <div className="space-y-3">
        <div className="text-sm text-text-3">This session was abandoned.</div>
        {onExit && <Button onClick={onExit}>Back</Button>}
      </div>
    );
  }

  return (
    <div className="mb-5 space-y-3">
      {session.format === "exam" ? (
        <ExamFormat controller={controller} />
      ) : (
        <PracticeFormat controller={controller} />
      )}
      <div className="flex items-center justify-between">
        <SyncIndicator status={syncStatus} />
        <Button
          variant="ghost"
          onClick={async () => {
            await abandon();
            onExit?.();
          }}
        >
          Abandon session
        </Button>
      </div>
    </div>
  );
}
