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
import { useEffect, useState } from "react";
import { Button } from "../../../ui/Button.jsx";
import { useExamSessionController } from "./useExamSessionController.js";
import { TutorPanel } from "./TutorPanel.jsx";
import { useTutorExplanation } from "./useTutorExplanation.js";
import { ERROR_REASONS, extractLeadIn } from "./questionReading.js";
import { recordReflection } from "../../../stores/learnerEvidence.js";

// Task 12, Part B1 — additive tutor-mode mount. Each instance owns its own
// `useTutorExplanation` call (the hook's cache is module-level and keyed by
// questionId, so mounting one per question is cheap and safe).
//
// Final-review fix C2 — `callAI` is threaded down from ExamContainer (via
// this component's `callAI` prop) into `useTutorExplanation`'s third `deps`
// argument, the same DI convention `explainQuestion`/`generateMcqs` already
// use elsewhere. `useTutorExplanation.js` no longer caches an `{error}`
// result, so a question whose first tutor request failed will genuinely
// retry (not just replay the cached error) the next time `request()` is
// called for it — see that file's header for the retry design.
function TutorPanelForQuestion({ question, callAI }) {
  const { text, loading, error, request } = useTutorExplanation(question, { enabled: true }, { callAI });
  return <TutorPanel question={question} onRequest={request} text={text} loading={loading} error={error} />;
}

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

function QuestionMeta({ question }) {
  const objectiveCount = question?.objectiveIds?.length || 0;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-text-3">
      {question?.difficulty && <span className="rounded border border-border px-1.5 py-0.5">{question.difficulty}</span>}
      {objectiveCount > 0 && <span className="rounded border border-border px-1.5 py-0.5">{objectiveCount} objective{objectiveCount === 1 ? "" : "s"}</span>}
      {question?.source && <span className="rounded border border-border px-1.5 py-0.5">{question.source}</span>}
      {Number.isFinite(question?.schoolStyleScore) && (
        <span className="rounded border border-border px-1.5 py-0.5" title="Structural similarity to your uploaded school questions">
          school style {question.schoolStyleScore}%
        </span>
      )}
    </div>
  );
}

function LeadInCue({ stem }) {
  return (
    <div className="mb-2 rounded border-l-2 border-accent bg-panel px-2.5 py-2">
      <div className="font-mono text-[11px] uppercase tracking-wider text-text-3">Lead-in first · define the task</div>
      <div className="mt-1 text-sm font-semibold text-text-1">{extractLeadIn(stem)}</div>
    </div>
  );
}

function MissReflection({ userId }) {
  const [selected, setSelected] = useState(null);
  return (
    <div className="mt-2 rounded border border-border bg-panel p-2.5">
      <div className="mb-2 font-mono text-[12px] font-bold text-text-2">What most caused this miss?</div>
      <div className="flex flex-wrap gap-1.5">
        {ERROR_REASONS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => {
            if (selected) return;
            setSelected(value);
            recordReflection(userId, value);
          }} className={`rounded border px-2 py-1 text-[12px] ${selected === value ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-1"}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
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

function ExamFormat({ controller, submitOpts }) {
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
          <QuestionMeta question={q} />
          <LeadInCue stem={q.stem} />
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
        <Button onClick={() => submit(submitOpts)} disabled={submitting}>
          {submitting ? "Submitting…" : "Submit exam"}
        </Button>
      </div>
    </div>
  );
}

// I1 fix — practice format previously had no submit control at all: the
// Next button just disabled itself with "Last question" once the final
// question was answered, so the only way to end a practice session was
// Abandon — which by design never finalizes (no recordAnswer/weak-concept
// writes), so practice results never reached stats or the dashboard. A
// "Finish" button, reachable once the last question is answered/revealed,
// calls the same `submit()` the controller already exposes for format
// "exam" — same function, now reachable from practice's UI too.
function PracticeFormat({ controller, tutorModeEnabled, submitOpts, callAI }) {
  const { session, currentIndex, setCurrentIndex, answerQuestion, submit, submitting } = controller;
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
        <QuestionMeta question={q} />
        <LeadInCue stem={q.stem} />
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
            {tutorModeEnabled && <TutorPanelForQuestion question={q} callAI={callAI} />}
            {currentIndex + 1 >= questions.length ? (
              <Button onClick={() => submit(submitOpts)} disabled={submitting}>
                {submitting ? "Submitting…" : "Finish"}
              </Button>
            ) : (
              <Button onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>
                Next →
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Task 12, Part B1 — the post-submission per-question review for format
// "exam". Format "exam" never reveals correctness during the session (no
// per-question feedback by design — see the module doc), so there is no
// pre-existing reveal to place this alongside; it's new, additive UI.
//
// I2 fix — this review (and its score line) previously only rendered when
// `tutorModeEnabled` was on, which defaults to false — a submitted exam
// otherwise showed bare "Submitted." with no score or per-question review at
// all. Now this always renders for a submitted format-"exam" session;
// `tutorModeEnabled` only gates the `TutorPanelForQuestion` breakdown within
// it, which is the actual preference-gated piece.
function SubmittedExamReview({ session, tutorModeEnabled, callAI, userId }) {
  const questions = session.questions || [];
  const correctCount = questions.filter((q) => pickedFor(session, q.questionId) === q.correct).length;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] uppercase tracking-wider text-accent-text">Review</div>
        <div data-testid="exam-score" className="font-mono text-sm font-bold text-text-1">
          {correctCount} of {questions.length} correct
        </div>
      </div>
      {questions.map((q) => {
        const picked = pickedFor(session, q.questionId);
        return (
          <div key={q.questionId} className="rounded-lg border border-border bg-bg-elevated p-3">
            <QuestionMeta question={q} />
            <LeadInCue stem={q.stem} />
            <div className="mb-2 text-sm text-text-1">{q.stem}</div>
            <ChoiceList choices={q.choices} picked={picked} revealed correct={q.correct} onPick={() => {}} />
            {q.explanation && (
              <div className="mt-2 rounded border-l-2 border-accent bg-panel p-3 text-[13px] leading-relaxed text-text-2">
                {q.explanation}
              </div>
            )}
            {picked !== q.correct && <MissReflection userId={userId} />}
            {tutorModeEnabled && <TutorPanelForQuestion question={q} callAI={callAI} />}
          </div>
        );
      })}
    </div>
  );
}

// `blockId` is part of the documented prop contract (kept small/stable for
// callers) even though this component doesn't need it directly:
// `sessionId`/`userId` are enough to drive the controller, and the session
// doc itself already carries blockId.
export function ExamSessionRunner({
  sessionId,
  userId,
  // eslint-disable-next-line no-unused-vars -- see note above.
  blockId,
  blockName = "",
  lectureLabelsByLectureId = {},
  onExit,
  tutorModeEnabled = false,
  callAI,
}) {
  const controller = useExamSessionController(sessionId, userId);
  const { session, loading, error, submit, abandon, submitResult, submitting, syncStatus } = controller;

  // I6 fix — `finalizeExamSession`'s `blockName`/`lectureLabelsByLectureId`
  // options were threaded correctly through finalize.js/finalizeLogic.js,
  // but `submit()` was called with no arguments at every call site here, so
  // every exam-derived weak-concept entry got a raw lectureId as its display
  // label forever. These come from ExamContainer (which already builds
  // `lecturesById`) via props, and are passed into every `submit()` call.
  const submitOpts = { blockName, lectureLabelsByLectureId };

  // Resume-on-mount: a session left in "finalizing" (a prior submit call was
  // interrupted before completing) shows a distinct "finishing up" state and
  // the component's job — not the hook's — is to call submit() again; safe
  // per Task 7's idempotent/resumable design.
  useEffect(() => {
    if (session?.status === "finalizing") submit(submitOpts);
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
          <Button onClick={() => submit(submitOpts)} disabled={submitting}>
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
        {session.format === "exam" && (
          <SubmittedExamReview session={session} tutorModeEnabled={tutorModeEnabled} callAI={callAI} userId={userId} />
        )}
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
        <ExamFormat controller={controller} submitOpts={submitOpts} />
      ) : (
        <PracticeFormat
          controller={controller}
          tutorModeEnabled={tutorModeEnabled}
          submitOpts={submitOpts}
          callAI={callAI}
        />
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
