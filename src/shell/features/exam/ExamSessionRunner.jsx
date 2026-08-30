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
import { SchoolQuestionFigure } from "./SchoolQuestionFigure.jsx";
import { Button } from "../../../ui/Button.jsx";
import { advanceOnEnter } from "../../../ui/nextQuestion.js";
import { QuestionStem } from "../../../ui/QuestionStem.jsx";
import { useExamSessionController } from "./useExamSessionController.js";
import { TutorPanel } from "./TutorPanel.jsx";
import { useTutorExplanation } from "./useTutorExplanation.js";
import { ERROR_REASONS, extractLeadIn } from "./questionReading.js";
import { recordReflection } from "../../../stores/learnerEvidence.js";

function sessionLabel(session) {
  if (session.sourceType !== "question-bank") return "Exam";
  return /examsoft|esoft|imcq/i.test(session.sourceFile || "") ? "School quiz" : "Homework";
}

function SessionTitle({ session }) {
  if (session.sourceType !== "question-bank") return null;
  return <h2 className="text-lg font-semibold text-text-1">{String(session.sourceFile || "School homework").replace(/\.(pdf|md|txt)$/i, "").replace(/[+_]+/g, " ")}</h2>;
}

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
            if (selected === value) return;
            recordReflection(userId, value, selected);
            setSelected(value);
          }} aria-pressed={selected === value} className={`rounded border-2 px-2.5 py-1.5 text-[12px] font-medium ${selected === value ? "border-accent bg-accent/15 text-text-1 ring-2 ring-accent/40" : "border-border text-text-3 hover:border-border-strong hover:text-text-1"}`}>
            {selected === value ? "✓ " : ""}{label}
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

function ChoiceList({ questionId, choices, picked, revealed, correct, onPick }) {
  const [crossed, setCrossed] = useState(new Set());
  useEffect(() => setCrossed(new Set()), [questionId]);
  return (
    <div className="flex flex-col gap-1.5">
      {Object.entries(choices || {}).map(([letter, text]) => {
        const isPicked = picked === letter;
        const isCrossed = !revealed && crossed.has(letter);
        const borderCls = !revealed
          ? isPicked
            ? "border-accent bg-accent/15 ring-2 ring-accent/40"
            : "border-border hover:border-border-strong cursor-pointer"
          : letter === correct
            ? "border-good"
            : isPicked
              ? "border-bad"
              : "border-border opacity-60";
        return (
          <div key={letter} className="flex items-stretch gap-2">
          <button
            type="button"
            disabled={revealed || isCrossed}
            onClick={() => onPick(letter)}
            aria-pressed={isPicked}
            className={
              "flex min-h-11 flex-1 items-center gap-2 rounded-lg border bg-bg px-3 py-2 text-left text-xs text-text-1 " +
              (isCrossed ? "line-through opacity-40 " : "") +
              borderCls
            }
          >
            <span className="font-mono text-text-3">{letter}</span>
            <span className="flex-1">{text}</span>
            {isPicked && !revealed && <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white">SELECTED</span>}
          </button>
          {!revealed && <button type="button" aria-label={`${isCrossed ? "Restore" : "Cross out"} choice ${letter}`} aria-pressed={isCrossed} onClick={() => {
            setCrossed(current => {
              const next = new Set(current);
              if (next.has(letter)) next.delete(letter); else next.add(letter);
              return next;
            });
          }} className="min-h-11 w-11 rounded-lg border border-border text-text-3 hover:text-text-1">{isCrossed ? "↩" : "×"}</button>}
          </div>
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
    <div className="space-y-3" onKeyDown={(event) => advanceOnEnter(event, () => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1)), !!q && pickedFor(session, q.questionId) != null && currentIndex < questions.length - 1 && !submitting)}>
      <div className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated px-3 py-2">
        <div className="font-mono text-[12px] uppercase tracking-wider text-accent-text">
          {sessionLabel(session)} · {answeredCount}/{questions.length} answered
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
          <QuestionStem text={q.stem} questionId={q.questionId} />
          <SchoolQuestionFigure question={q} />
          <ChoiceList
            questionId={q.questionId}
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
      </div>
      <div className="flex flex-col gap-2 rounded-lg border-2 border-border-strong bg-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <div><div className="text-xs font-bold text-text-1">Finished reviewing?</div><div className="font-mono text-[11px] text-text-3">{answeredCount} answered · {questions.length - answeredCount} {session.sourceType === "question-bank" ? "unanswered · remain available in this set" : "return to reserve"}</div></div>
        <Button variant="outline" onClick={() => {
          if (window.confirm(`Submit ${answeredCount} answered questions for grading? ${questions.length - answeredCount} unanswered questions will not count against you.`)) submit(submitOpts);
        }} disabled={submitting}>{submitting ? "Grading answered questions…" : `Submit ${sessionLabel(session).toLowerCase()} · finish & grade`}</Button>
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
    <div className="space-y-3" onKeyDown={(event) => advanceOnEnter(event, () => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1)), revealed && currentIndex < questions.length - 1 && !submitting)}>
      <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-wider text-accent-text">
        <span>Practice</span>
        <span className="text-text-3">
          {currentIndex + 1}/{questions.length}
        </span>
      </div>

      <div className="rounded-lg border border-border bg-bg-elevated p-3">
        <QuestionMeta question={q} />
        <LeadInCue stem={q.stem} />
        <QuestionStem text={q.stem} questionId={q.questionId} />
        <SchoolQuestionFigure question={q} />
        <ChoiceList
          questionId={q.questionId}
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
  const [filter, setFilter] = useState("incorrect");
  const answered = questions.filter((q) => pickedFor(session, q.questionId) != null);
  const correctCount = answered.filter((q) => pickedFor(session, q.questionId) === q.correct).length;
  const incorrectCount = answered.length - correctCount;
  const percent = answered.length ? Math.round(correctCount / answered.length * 100) : 0;
  const visible = questions.filter((q) => {
    const picked = pickedFor(session, q.questionId);
    if (filter === "correct") return picked === q.correct;
    if (filter === "incorrect") return picked != null && picked !== q.correct;
    if (filter === "unused") return picked == null;
    return true;
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] uppercase tracking-wider text-accent-text">Review</div>
        <div data-testid="exam-score" className="font-mono text-sm font-bold text-text-1">
          {correctCount}/{answered.length} correct · {percent}%
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Score", `${percent}%`], ["Correct", correctCount], ["Incorrect", incorrectCount], ["Unused", questions.length - answered.length]].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-panel p-3"><div className="font-mono text-[10px] uppercase text-text-3">{label}</div><div className="text-lg font-bold text-text-1">{value}</div></div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {[["incorrect", `Needs repair (${incorrectCount})`], ["correct", `Correct (${correctCount})`], ["unused", `Unused (${questions.length - answered.length})`], ["all", `All (${questions.length})`]].map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-lg border-2 px-3 py-2 text-xs font-bold ${filter === value ? "border-accent bg-accent/15 ring-2 ring-accent/30" : "border-border"}`}>{filter === value ? "✓ " : ""}{label}</button>)}
      </div>
      {visible.map((q, index) => {
        const picked = pickedFor(session, q.questionId);
        return (
          <details key={q.questionId} className="rounded-lg border border-border bg-bg-elevated p-3" open={filter === "incorrect" && index === 0}>
            <summary className="cursor-pointer text-sm font-bold text-text-1">{picked == null ? "Unused" : picked === q.correct ? "✓ Correct" : "✕ Needs repair"} · {extractLeadIn(q.stem)}</summary>
            <div className="mt-3">
            <QuestionMeta question={q} />
            <LeadInCue stem={q.stem} />
            <div className="mb-2 whitespace-pre-line text-sm text-text-1">{q.stem}</div>
            <SchoolQuestionFigure question={q} />
            <ChoiceList questionId={q.questionId} choices={q.choices} picked={picked} revealed correct={q.correct} onPick={() => {}} />
            {q.explanation && (
              <div className="mt-2 rounded border-l-2 border-accent bg-panel p-3 text-[13px] leading-relaxed text-text-2">
                {q.explanation}
              </div>
            )}
            {picked !== q.correct && <MissReflection userId={userId} />}
            {tutorModeEnabled && <TutorPanelForQuestion question={q} callAI={callAI} />}
            </div>
          </details>
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
        <SessionTitle session={session} />
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-lg border border-border bg-bg-elevated p-2 shadow-sm"><div className="text-sm font-bold text-text-1">Submitted. {sessionLabel(session)} saved and graded.</div>{onExit && <Button onClick={onExit}>Done</Button>}</div>
        {(session.format === "exam" || session.sourceType === "question-bank") && (
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
      <SessionTitle session={session} />
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
        <div className="flex gap-2">
          {onExit && <Button variant="outline" onClick={onExit}>Save &amp; exit</Button>}
          <Button variant="ghost" onClick={async () => {
            if (typeof window !== "undefined" && !window.confirm("Abandon this session? Unanswered questions will return to your reserve.")) return;
            await abandon();
            onExit?.();
          }}>Abandon session</Button>
        </div>
      </div>
    </div>
  );
}
