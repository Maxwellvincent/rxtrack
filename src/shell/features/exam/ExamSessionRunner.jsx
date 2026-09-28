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
import { QuestionExplanation } from "../../../ui/QuestionExplanation.jsx";
import { ChoiceValue, hasTableChoices } from "../../../ui/ChoiceValue.jsx";
import { QuestionQualityRating } from "../../../ui/QuestionQualityRating.jsx";
import { useExamSessionController } from "./useExamSessionController.js";
import { TutorPanel } from "./TutorPanel.jsx";
import { useTutorExplanation } from "./useTutorExplanation.js";
import { ERROR_REASONS, extractLeadIn } from "./questionReading.js";
import { orderedChoiceEntries } from "./choiceOrder.js";
import { printQuestionWorksheet } from "./questionWorksheet.js";
import { recordReflection } from "../../../stores/learnerEvidence.js";
import { classifyQuestionOrder, QUESTION_ORDER_LABELS } from "../../../engine/questionOrder.js";

function sessionLabel(session) {
  if (session.sourceType !== "question-bank") return "Exam";
  return /examsoft|esoft|imcq/i.test(session.sourceFile || "") ? "School quiz" : "Homework";
}

function SessionTitle({ session }) {
  if (session.sourceType !== "question-bank") return session.title ? <h2 className="text-lg font-semibold text-text-1">{session.title}</h2> : null;
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

function QuestionMeta({ question, objectivesById = {}, lectureLabelsByLectureId = {} }) {
  const objectiveCount = question?.objectiveIds?.length || 0;
  const lectureId = question?.lectureId || question?.lectureIds?.[0];
  // Lecture IDs are stable; labels are not. Prefer the latest lecture metadata
  // so a later rename is reflected in already-prepared and resumed exams.
  const lectureLabel = lectureLabelsByLectureId[lectureId] || question?.lectureLabel || question?.lectureTitle;
  const objectiveLabels = (question?.objectiveIds || []).map((id) => {
    const objective = objectivesById[id];
    const code = objective?.code || objective?.objectiveCode;
    const text = objective?.objective || objective?.text || objective?.content;
    return [code, text].filter(Boolean).join(" · ") || id;
  });
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 font-mono text-[11px] text-text-3">
      {question?.difficulty && <span className="rounded border border-border px-1.5 py-0.5">{question.difficulty}</span>}
      <span className="rounded border border-border px-1.5 py-0.5" title="Structural reasoning level, inferred from the question and objective; not a measure of medical correctness">
        {QUESTION_ORDER_LABELS[question?.orderLevel || classifyQuestionOrder(question, objectivesById[question?.objectiveIds?.[0]])]}
      </span>
      <span className="max-w-full rounded border border-border px-1.5 py-0.5">Lecture: {lectureLabel || lectureId || "not linked"}</span>
      {objectiveLabels.map((label, index) => <span key={`${question.questionId}-objective-${index}`} className="max-w-full rounded border border-border px-1.5 py-0.5" title={label}>Objective: {label}</span>)}
      {!objectiveCount && <span className="max-w-full rounded border border-border px-1.5 py-0.5">Objective: not linked yet</span>}
      {question?.source && <span className="rounded border border-border px-1.5 py-0.5">{question.source}</span>}
      {question?.sourceLectureClue && <span className="rounded border border-accent/40 bg-accent/5 px-1.5 py-0.5" title="Lecture label transcribed from the uploaded source; not a verified link to this block">Source says: {question.sourceLectureClue}</span>}
      {["needs-review", "unsupported-by-lecture"].includes(question?.sourceKeyReviewStatus) && <span className="rounded border border-bad/40 bg-bad/5 px-1.5 py-0.5 text-bad" title={question.sourceKeyCritique || "This imported source key/rationale needs review"}>Source key needs review</span>}
      {(question?.candidateLectureLinks || []).slice(0, 2).map((link, index) => <span key={`${question.questionId}-candidate-lecture-${index}`} className="max-w-full rounded border border-border px-1.5 py-0.5" title="Possible match based on uploaded question analysis; review before treating as a confirmed curriculum link">Possible lecture match: {link.label || link.id}</span>)}
      {(question?.candidateObjectiveLinks || []).slice(0, 2).map((link, index) => <span key={`${question.questionId}-candidate-objective-${index}`} className="max-w-full rounded border border-border px-1.5 py-0.5" title="Candidate objective match for review; does not count as objective coverage evidence">Possible objective match: {link.label || link.id}</span>)}
      {Number.isFinite(question?.schoolStyleScore) && (
        <span className="rounded border border-border px-1.5 py-0.5" title="Estimated structural fit against the aggregate shape of uploaded school questions; not a correctness or equivalence score">
          format fit (est.) {question.schoolStyleScore}%
        </span>
      )}
    </div>
  );
}

function LeadInCue({ stem }) {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem("rxt-show-reading-cue") === "true"; } catch { return false; }
  });
  if (!visible) {
    return (
      <button type="button" className="mb-2 text-[11px] font-medium text-text-3 underline underline-offset-2 hover:text-text-1" onClick={() => {
        try { localStorage.setItem("rxt-show-reading-cue", "true"); } catch { /* preference is optional */ }
        setVisible(true);
      }}>
        Show reading cue
      </button>
    );
  }
  return (
    <div className="mb-2 rounded border-l-2 border-accent bg-panel px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[11px] uppercase tracking-wider text-text-3">Lead-in first · define the task</div>
        <button type="button" className="text-[11px] text-text-3 underline hover:text-text-1" onClick={() => {
          try { localStorage.setItem("rxt-show-reading-cue", "false"); } catch { /* preference is optional */ }
          setVisible(false);
        }}>hide</button>
      </div>
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

function ChoiceList({ questionId, choices, picked, revealed, correct, onPick, choiceColumns = [], choiceLayout = null }) {
  const [crossed, setCrossed] = useState(new Set());
  useEffect(() => setCrossed(new Set()), [questionId]);
  return (
    <div className="flex flex-col gap-1.5">
      {orderedChoiceEntries(choices).map(([letter, text]) => {
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
            <span className="flex-1"><ChoiceValue value={text} columns={choiceColumns} table={choiceLayout === "table" || hasTableChoices({ choices, choiceLayout })} /></span>
            {isPicked && !revealed && <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white">SELECTED</span>}
            {revealed && letter === correct && <span className="rounded border-2 border-good bg-bg px-2 py-0.5 text-[10px] font-black text-text-1">✓ CORRECT</span>}
            {revealed && isPicked && letter !== correct && <span className="rounded border-2 border-bad bg-bg px-2 py-0.5 text-[10px] font-black text-text-1">✕ YOUR ANSWER</span>}
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

function QuestionNavigator({ questions, session, currentIndex, onSelect }) {
  return (
    <details className="mb-3 rounded-lg border border-border bg-bg-elevated p-2">
      <summary className="cursor-pointer px-1 py-1 text-sm font-medium text-text-2">
        Question navigator · {questions.filter((question) => pickedFor(session, question.questionId) != null).length}/{questions.length} answered · question {currentIndex + 1} selected
      </summary>
      <nav aria-label="Question navigation" className="mt-2 flex flex-wrap gap-1.5">
        {questions.map((question, index) => {
          const answered = pickedFor(session, question.questionId) != null;
          const current = index === currentIndex;
          return (
            <button
              key={question.questionId}
              type="button"
              data-question-state={current ? "current" : answered ? "answered" : "unanswered"}
              aria-current={current ? "step" : undefined}
              aria-label={`Question ${index + 1}${answered ? ", answered" : ", unanswered"}${current ? ", current" : ""}`}
              title={`Question ${index + 1} · ${answered ? "answered" : "unanswered"}`}
              onClick={() => onSelect(index)}
              className={
                "flex h-9 min-w-9 items-center justify-center gap-1 rounded border px-2 font-mono text-xs " +
                (current
                  ? "border-accent bg-accent/15 text-text-1 ring-2 ring-accent/30"
                  : answered
                    ? "border-good/60 bg-good/10 text-text-1"
                    : "border-border bg-bg text-text-3 hover:border-border-strong")
              }
            >
              {answered && <span aria-hidden="true">✓</span>}{index + 1}
            </button>
          );
        })}
      </nav>
    </details>
  );
}

function ExamFormat({ controller, submitOpts, objectivesById, lectureLabelsByLectureId }) {
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

      <QuestionNavigator questions={questions} session={session} currentIndex={currentIndex} onSelect={setCurrentIndex} />

      {!q && session.fillStatus === "generating" && <div role="status" className="rounded-lg border border-accent/40 bg-bg-elevated p-4 text-sm text-text-2">Preparing the first questions for this scope…</div>}

      {q && (
        <div className="rounded-lg border border-border bg-bg-elevated p-3">
          <QuestionMeta question={q} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
          <LeadInCue stem={q.stem} />
          <QuestionStem text={q.stem} questionId={q.questionId} />
          <SchoolQuestionFigure question={q} />
          <ChoiceList
            questionId={q.questionId}
            choices={q.choices}
            choiceColumns={q.choiceColumns}
            choiceLayout={q.choiceLayout}
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
        <Button variant="outline" disabled={submitting || session.fillStatus === "generating"} onClick={() => {
          if (window.confirm(`Submit ${answeredCount} answered questions for grading? ${questions.length - answeredCount} unanswered questions will not count against you.`)) submit(submitOpts);
        }}>{submitting ? "Grading answered questions…" : `Submit ${sessionLabel(session).toLowerCase()} · finish & grade`}</Button>
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
function PracticeFormat({ controller, tutorModeEnabled, submitOpts, callAI, userId, objectivesById, lectureLabelsByLectureId }) {
  const { session, currentIndex, setCurrentIndex, answerQuestion, submit, submitting } = controller;
  const questions = session.questions || [];
  const q = questions[currentIndex];
  const picked = q ? pickedFor(session, q.questionId) : null;
  const revealed = picked != null;
  const [draftChoice, setDraftChoice] = useState(picked);
  useEffect(() => setDraftChoice(picked), [q?.questionId, picked]);
  if (!q) return session.fillStatus === "generating" ? <div role="status" className="rounded-lg border border-accent/40 bg-bg-elevated p-4 text-sm text-text-2">Preparing questions for this scope…</div> : null;
  const isCorrect = revealed && picked === q.correct;

  return (
    <div className="space-y-3" onKeyDown={(event) => advanceOnEnter(event, () => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1)), revealed && currentIndex < questions.length - 1 && !submitting)}>
      <div className="flex items-center justify-between font-mono text-[12px] uppercase tracking-wider text-accent-text">
        <span>Practice</span>
        <span className="text-text-3">{(session.answers || []).length}/{questions.length} answered</span>
      </div>

      <QuestionNavigator questions={questions} session={session} currentIndex={currentIndex} onSelect={setCurrentIndex} />

      <div className="rounded-lg border border-border bg-bg-elevated p-3">
        <QuestionMeta question={q} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
        <LeadInCue stem={q.stem} />
        <QuestionStem text={q.stem} questionId={q.questionId} />
        <SchoolQuestionFigure question={q} />
        <ChoiceList
          questionId={q.questionId}
          choices={q.choices}
          choiceColumns={q.choiceColumns}
          choiceLayout={q.choiceLayout}
          picked={revealed ? picked : draftChoice}
          revealed={revealed}
          correct={q.correct}
          onPick={setDraftChoice}
        />

        {!revealed && (
          <div className="mt-3">
            <Button data-testid="check-answer" onClick={() => answerQuestion(q.questionId, draftChoice)} disabled={!draftChoice}>
              Check answer
            </Button>
          </div>
        )}

        {revealed && (
          <div className="mt-3 space-y-2">
            <div data-testid="practice-reveal" className={"text-xs " + (isCorrect ? "text-good" : "text-bad")}>
              {isCorrect ? "✓ Correct" : "✕ Incorrect"}
            </div>
            {(q.explanation || Object.keys(q.whyWrong || {}).length > 0) && (
              <QuestionExplanation text={q.explanation} correctLetter={q.correct} whyWrong={q.whyWrong} choices={q.choices} sourceType={q.sourceType || session.sourceType} />
            )}
            <QuestionQualityRating userId={userId} question={q} />
            {tutorModeEnabled && <TutorPanelForQuestion question={q} callAI={callAI} />}
            {currentIndex + 1 >= questions.length && session.fillStatus === "generating" ? (
              <div role="status" className="text-sm text-text-3">Your next question is being prepared…</div>
            ) : currentIndex + 1 >= questions.length ? (
              <Button onClick={() => submit(submitOpts)} disabled={submitting}>
                {submitting ? "Submitting…" : "Finish"}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}>← Prev</Button>
        <Button variant="outline" disabled={currentIndex >= questions.length - 1} onClick={() => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))}>Next →</Button>
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
function SubmittedExamReview({ session, tutorModeEnabled, callAI, userId, objectivesById, lectureLabelsByLectureId }) {
  const questions = session.questions || [];
  // Start with the complete, PDF-like exam review; filters remain available
  // for focused remediation after the full set is visible.
  const [filter, setFilter] = useState("all");
  const [worksheetError, setWorksheetError] = useState("");
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
  const exportMissedQuestions = () => {
    const missed = questions.filter((q) => {
      const picked = pickedFor(session, q.questionId);
      return picked != null && picked !== q.correct;
    }).map((question) => ({
      ...question,
      lectureLabel: question.lectureLabel || lectureLabelsByLectureId?.[question.lectureId || question.lectureIds?.[0]],
      objectiveLabels: (question.objectiveIds || []).map((id) => {
        const objective = objectivesById?.[id];
        const code = objective?.code || objective?.objectiveCode;
        const text = objective?.objective || objective?.text || objective?.content;
        return [code, text].filter(Boolean).join(" · ") || id;
      }),
    }));
    const result = printQuestionWorksheet(missed, {
      title: session.title || session.sourceFile?.replace(/\.(pdf|md|txt)$/i, "") || "Missed-question practice",
    });
    setWorksheetError(result.ok ? "" : result.error);
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[12px] uppercase tracking-wider text-accent-text">Review</div>
        <div data-testid="exam-score" className="font-mono text-sm font-bold text-text-1">
          {correctCount}/{answered.length} correct · {percent}%
        </div>
      </div>
      {incorrectCount > 0 && <div className="rounded-lg border border-accent/40 bg-bg-elevated p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-text-1">Take your missed questions to Goodnotes</div>
          <Button variant="outline" onClick={exportMissedQuestions}>Print / save worksheet as PDF</Button>
        </div>
        <p className="mt-1 text-xs text-text-3">Exports {incorrectCount} missed questions with their figures and full choices, plus space to reason. Answers are left out.</p>
        {worksheetError && <p role="alert" className="mt-2 text-xs text-bad">{worksheetError}</p>}
      </div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Score", `${percent}%`], ["Correct", correctCount], ["Incorrect", incorrectCount], ["Unused", questions.length - answered.length]].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-panel p-3"><div className="font-mono text-[10px] uppercase text-text-3">{label}</div><div className="text-lg font-bold text-text-1">{value}</div></div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {[["incorrect", `Incorrect (${incorrectCount})`], ["correct", `Correct (${correctCount})`], ["unused", `Unused (${questions.length - answered.length})`], ["all", `All (${questions.length})`]].map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} className={`rounded-lg border-2 px-3 py-2 text-xs font-bold ${filter === value ? "border-accent bg-accent/15 ring-2 ring-accent/30" : "border-border"}`}>{filter === value ? "✓ " : ""}{label}</button>)}
      </div>
      {visible.map((q) => {
        const picked = pickedFor(session, q.questionId);
        const lectureId = q.lectureId || q.lectureIds?.[0];
        const lectureLabel = q.lectureLabel || lectureLabelsByLectureId?.[lectureId];
        const objectiveLabel = (q.objectiveIds || []).map((id) => {
          const objective = objectivesById?.[id];
          return objective?.objective || objective?.text || objective?.code || objective?.objectiveCode || id;
        }).filter(Boolean).join("; ");
        const context = [lectureLabel, objectiveLabel].filter(Boolean).join(" · ");
        return (
          <article key={q.questionId} data-testid="review-question" className="rounded-lg border border-border bg-bg-elevated p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-accent-text">Question {questions.findIndex((item) => item.questionId === q.questionId) + 1} · {picked == null ? "Unused" : picked === q.correct ? "✓ Correct" : "✕ Incorrect"}</h3>
              {context && <span className="text-xs text-text-3">{context}</span>}
            </div>
            <QuestionMeta question={q} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
            <QuestionStem text={q.stem} questionId={q.questionId} />
            <SchoolQuestionFigure question={q} />
            <ChoiceList questionId={q.questionId} choices={q.choices} choiceColumns={q.choiceColumns} choiceLayout={q.choiceLayout} picked={picked} revealed correct={q.correct} onPick={() => {}} />
            <div className="mt-2"><QuestionQualityRating userId={userId} question={q} /></div>
            {picked !== q.correct && <MissReflection userId={userId} />}
            {tutorModeEnabled && <TutorPanelForQuestion question={q} callAI={callAI} />}
          </article>
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
  objectivesById = {},
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
        {(session.questions || []).length > 0 && (
          <SubmittedExamReview session={session} tutorModeEnabled={tutorModeEnabled} callAI={callAI} userId={userId} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
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

  if (session.fillStatus === "partial" && !(session.questions || []).length) {
    return (
      <div className="space-y-3">
        <SessionTitle session={session} />
        <div role="alert" className="rounded-lg border border-bad/40 bg-bg-elevated p-4 text-sm text-text-2">
          No questions could be prepared for this scope.{session.fillError ? ` ${session.fillError}` : ""}
        </div>
        {onExit && <Button onClick={async () => { await controller.abandon(); onExit(); }}>Back to exam center</Button>}
      </div>
    );
  }

  return (
    <div className="mb-5 space-y-3">
      <SessionTitle session={session} />
      {session.fillStatus === "generating" && <div role="status" className="rounded-lg border border-accent/40 bg-bg-elevated px-3 py-2 text-sm text-text-2">{session.questions?.length || 0}/{session.targetQuestionCount || "…"} questions ready. You can start answering now; missing questions are generating. {session.format === "exam" ? "The timer starts when the requested set is ready." : ""} Keep this tab open until preparation finishes.</div>}
      {session.fillStatus === "partial" && <div role="status" className="rounded-lg border border-accent/40 bg-bg-elevated px-3 py-2 text-sm text-text-2">{session.questions?.length || 0}/{session.targetQuestionCount || session.questions?.length || 0} questions ready. {session.fillError ? `The remaining questions could not be prepared: ${session.fillError}` : "The requested set could not be fully prepared."} You can continue with what is ready.</div>}
      {session.format === "exam" ? (
        <ExamFormat controller={controller} submitOpts={submitOpts} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
      ) : (
        <PracticeFormat
          controller={controller}
          tutorModeEnabled={tutorModeEnabled}
          submitOpts={submitOpts}
          callAI={callAI}
          userId={userId}
          objectivesById={objectivesById}
          lectureLabelsByLectureId={lectureLabelsByLectureId}
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
