import {sessionEvidenceEvent} from "./sessionEvidence.js";
import {markReasoningAssistance,saveReasoningCoach} from './reasoningCoachSession.js';
import {HelpMeReason} from '../../../ui/HelpMeReason.jsx';
import {ReservedAssessmentReport,ReservedAssessmentFigure} from './ReservedAssessmentReport.jsx';
import { SourceBankRepair } from './SourceBankRepair.jsx';
import { updateExamSessionTransaction } from '../../../supabase.js';
import { practiceSection, practiceSections, sectionQuestionIndices, firstSectionQuestion } from './practiceSections.js';
import { restoreVisualChoices } from "../../../engine/visualChoiceLabels.js";
import { splitQuestionStemSource } from "../../../engine/questionStemSource.js";
import { ObjectiveLearningReport } from "../../../ui/ObjectiveLearningReport.jsx";
import { questionLearningContext } from "../../../engine/learningLoop.js";
import * as learnerEvidenceStore from "../../../stores/learnerEvidence.js";
import * as questionFigures from "../../../stores/questionFigures.js";
import { useStoreResource } from "../../hooks/useStoreResource.js";
import { LearningGapNote } from "../../../ui/LearningGapNote.jsx";
import { protectSessionScoring } from "../../../engine/questionScoringPolicy.js";
import * as questionRatingsStore from "../../../stores/questionRatings.js";
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
import { useEffect, useState, useMemo, useRef } from "react";
import { quietBackgroundJobs } from "../../backgroundJobs.js";
import { ExamPreparationStatus } from "./ExamPreparationStatus.jsx";
import { linkSourceLecture, lectureReviewSummary } from "./questionBankLinks.js";
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
import { callAIJSON } from "../../../aiClient.js";
import { diagnoseQuestionMiss, MISS_TYPE_LABELS } from "../../../engine/questionReasoning.js";
import { recordMissType } from "../../../stores/learnerEvidence.js";

export function sittingAnswers(session, baseline = []) {
  const prior = new Map(baseline.map(answer => [answer.questionId, answer.value]));
  return (session.answers || []).filter(answer => answer.value != null && prior.get(answer.questionId) !== answer.value);
}

function SavedPracticeSummary({ session, baseline, userId, labels, onExit, onResume, onNavigateToLecture }) {
  const answers = sittingAnswers(session, baseline);
  const scoped = protectSessionScoring({ ...session, answers }, questionRatingsStore.read(userId).ratings);
  const answered = (scoped.questions || []).filter(q => pickedFor(scoped, q.questionId) != null);
  const correct = answered.filter(q => pickedFor(scoped, q.questionId) === q.correct).length;
  const missed = answered.length - correct;
  const rows = lectureReviewSummary(scoped, labels).filter(row => row.misses > 0);
  const unlinked = answered.filter(q => !q.lectureId && pickedFor(scoped, q.questionId) !== q.correct).length;
  const total = (session.questions || []).filter(q => pickedFor(session, q.questionId) != null).length;
  return <section aria-label="Saved sitting summary" className="space-y-4 rounded-lg border border-border bg-bg-elevated p-4">
    <h2 className="text-lg font-bold">Progress saved · this sitting</h2>
    <p className="text-sm text-text-2">New or changed answers since you opened this practice session. Your homework remains resumable.</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Answered", answers.length], ["Correct", correct], ["Wrong", missed], ["Accuracy", answered.length ? `${Math.round(correct / answered.length * 100)}%` : "—"]].map(([label,value]) => <div key={label} className="rounded border border-border p-3"><strong className="block text-2xl">{value}</strong><span>{label}</span></div>)}</div>
    {answers.length > answered.length && <p>{answers.length - answered.length} excluded from scoring.</p>}
    <p>Whole set: {total}/{session.questions?.length || 0} answered · {Math.max(0, (session.questions?.length || 0) - total)} remaining.</p>
    <details className="rounded border border-border p-3"><summary className="cursor-pointer font-semibold">Section results · saved homework</summary><ul className="mt-2 space-y-2">{practiceSections(session.questions, session.answers, labels, protectSessionScoring(session, questionRatingsStore.read(userId).ratings)).map(section=><li key={section.key}><strong>{section.title || section.label}</strong> · {section.answered}/{section.indices.length} answered · {section.accuracy == null ? 'No revealed scores yet' : `${section.accuracy}% correct (${section.correct}/${section.scored})`}{section.pending ? ` · ${section.pending} saved without reveal` : ''}</li>)}</ul></details>
    <h3 className="font-semibold">Lectures to revisit from this sitting</h3>
    {!missed && <p>{answered.length ? "No scored misses this sitting." : "No new scored answers this sitting."}</p>}
    <ul className="space-y-2">{rows.map(row => <li key={row.lectureId}><strong>{row.label}</strong> · {row.misses} wrong of {row.answered} answered{onNavigateToLecture && <button className="ml-2 underline" onClick={() => onNavigateToLecture(row.lectureId)}>Review lecture</button>}</li>)}</ul>
    {unlinked > 0 && <p>{unlinked} missed questions have no confirmed lecture link yet; they still count toward your score.</p>}
    <div className="flex gap-2"><Button onClick={onExit}>Done · exit to question banks</Button><Button variant="outline" onClick={onResume}>Continue practice</Button></div>
  </section>;
}

function sessionLabel(session) {
  if(session.purpose==='reserved-assessment')return 'Reserved assessment';
  if (session.sourceType !== "question-bank") return "Exam";
  return /examsoft|esoft|imcq/i.test(session.sourceFile || "") ? "School quiz" : "Homework";
}

function SessionTitle({ session }) {
  if (session.sourceType !== "question-bank") return session.title ? <h2 className="text-lg font-semibold text-text-1">{session.title}</h2> : null;
  return <div><h2 className="text-lg font-semibold text-text-1">{String(session.sourceFile || "School homework").replace(/\.(pdf|md|txt)$/i, "").replace(/[+_]+/g, " ")}</h2>
    {!!session.sourceExclusions?.length && <details className="mt-2 text-sm text-text-2"><summary>{session.sourceExclusions.length} source questions held for key review · excluded from this session and score</summary><ul>{session.sourceExclusions.map((q,i)=><li key={q.id || i}>{q.section} · Question {q.number ?? 'unknown'}</li>)}</ul></details>}
  </div>;
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

export function uniqueQuestionLinks(links = []) {
  const seen = new Set();
  return links.filter(link => {
    const label = String(link.label || link.id || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!label || seen.has(label)) return false;
    seen.add(label); return true;
  });
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
      {(question?.sourceType === 'question-bank' || question?.sourceSection) && <span className="w-full py-1 font-sans text-sm font-semibold text-text-1">{question.sourceSection ? `Section: ${question.sourceSectionTitle || question.sourceSection}${question.sourceSectionTitle ? ` · ${question.sourceSection}` : ''}` : `Lecture: ${lectureLabel || 'not linked yet'}`}{question.sourceSection && lectureLabel ? ` · ${lectureLabel}` : ''}</span>}
      <details className="w-full"><summary className="cursor-pointer py-1">Question details & source links</summary><div className="mt-1 flex flex-wrap gap-1.5">
      <span className="max-w-full rounded border border-border px-1.5 py-0.5">Lecture: {lectureLabel || lectureId || "not linked"}</span>
      {objectiveLabels.map((label, index) => <span key={`${question.questionId}-objective-${index}`} className="max-w-full rounded border border-border px-1.5 py-0.5" title={label}>Objective: {label}</span>)}
      {!objectiveCount && <span className="max-w-full rounded border border-border px-1.5 py-0.5">Objective: not linked yet</span>}
      {question?.source && <span className="rounded border border-border px-1.5 py-0.5">{question.source}</span>}
      {question?.sourceLectureClue && <span className="rounded border border-accent/40 bg-accent/5 px-1.5 py-0.5" title="Explicit source label; matched links use this block’s lecture number and title">Source says: {question.sourceLectureClue}</span>}
      {["needs-review", "unsupported-by-lecture"].includes(question?.sourceKeyReviewStatus) && <span className="rounded border border-bad/40 bg-bad/5 px-1.5 py-0.5 text-bad" title={question.sourceKeyCritique || "This imported source key/rationale needs review"}>Source key needs review</span>}
      {uniqueQuestionLinks(question?.candidateLectureLinks).slice(0, 2).map((link, index) => <span key={`${question.questionId}-candidate-lecture-${index}`} className="max-w-full rounded border border-border px-1.5 py-0.5" title="Possible match based on uploaded question analysis; review before treating as a confirmed curriculum link">Possible lecture match: {link.label || link.id}</span>)}
      {uniqueQuestionLinks(question?.candidateObjectiveLinks).slice(0, 2).map((link, index) => <span key={`${question.questionId}-candidate-objective-${index}`} className="max-w-full rounded border border-border px-1.5 py-0.5" title="Candidate objective match for review; does not count as objective coverage evidence">Possible objective match: {link.label || link.id}</span>)}
      {Number.isFinite(question?.schoolStyleScore) && (
        <span className="rounded border border-border px-1.5 py-0.5" title="Estimated structural fit against the aggregate shape of uploaded school questions; not a correctness or equivalence score">
          format fit (est.) {question.schoolStyleScore}%
        </span>
      )}
      </div></details>
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

function MissReflection({ userId, question }) {
  const [selected, setSelected] = useState(null);
  return (
    <div className="mt-2 rounded border border-border bg-panel p-2.5">
      <div className="mb-2 font-mono text-[12px] font-bold text-text-2">What most caused this miss?</div>
      <div className="flex flex-wrap gap-1.5">
        {ERROR_REASONS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => {
            if (selected === value) return;
            recordReflection(userId, value, selected, question?.questionKey || question?.poolId || question?.id || question?.questionId);
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

function ChoiceList({questionId,...props}) {
  return <QuestionChoices key={questionId} {...props}/>;
}
function QuestionChoices({ choices, picked, revealed, correct, onPick, locked = false, choiceColumns = [], choiceLayout = null }) {
  const [crossed, setCrossed] = useState(new Set());
  return (
    <div className="flex flex-col gap-1.5">
      {orderedChoiceEntries(choices).map(([letter, text]) => {
        const isPicked = picked === letter;
        const isCrossed = !revealed && crossed.has(letter);
        const stateCls = !revealed
          ? isPicked
            ? "border-accent bg-accent/15 ring-2 ring-accent/30"
            : "border-border hover:border-border-strong"
          : letter === correct
            ? "border-good bg-good/10 ring-2 ring-good/40"
            : isPicked
              ? "border-bad bg-bad/10"
              : "border-border opacity-60";
        return (
          <div key={letter} className={`flex min-h-12 items-stretch overflow-hidden rounded-lg border bg-bg ${isCrossed ? "opacity-45 " : ""}${stateCls}`}>
          <button
            type="button"
            disabled={revealed || locked || isCrossed}
            onClick={() => onPick(isPicked ? null : letter)}
            aria-pressed={isPicked}
            className={
              "flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm text-text-1 " +
              (isCrossed ? "line-through " : "")
            }
          >
            <span className="font-mono text-text-3">{letter}</span>
            <span className="flex-1"><ChoiceValue value={text} columns={choiceColumns} table={choiceLayout === "table" || hasTableChoices({ choices, choiceLayout })} /></span>
            {isPicked && !revealed && <span className="rounded bg-accent px-2 py-0.5 text-[10px] font-bold text-white">SELECTED</span>}
            {revealed && letter === correct && <span className="rounded border-2 border-good bg-bg px-2 py-0.5 text-[10px] font-black text-text-1">✓ CORRECT</span>}
            {revealed && isPicked && letter !== correct && <span className="rounded border-2 border-bad bg-bg px-2 py-0.5 text-[10px] font-black text-text-1">✕ YOUR ANSWER</span>}
          </button>
          {!revealed && !locked && <button type="button" aria-label={`${isCrossed ? "Restore" : "Cross out"} choice ${letter}`} aria-pressed={isCrossed} onClick={() => {
            if (!isCrossed && isPicked) onPick(null);
            setCrossed(current => {
              const next = new Set(current);
              if (next.has(letter)) next.delete(letter); else next.add(letter);
              return next;
            });
          }} className="w-10 shrink-0 border-l border-border text-text-3 hover:bg-bg-2 hover:text-text-1 sm:w-11">{isCrossed ? "↩" : "×"}</button>}
          </div>
        );
      })}
    </div>
  );
}

function MissDiagnosis({question,initialResult=null,...props}) {
  return <QuestionMissDiagnosis key={`${question?.questionId}:${JSON.stringify(initialResult)}`} question={question} initialResult={initialResult} {...props}/>;
}
function QuestionMissDiagnosis({ question, selectedChoice, initialResult = null, onComplete, onSkip, onNavigateToLecture }) {
  const [patient, setPatient] = useState("");
  const [ask, setAsk] = useState("");
  const [prediction, setPrediction] = useState("");
  const [result, setResult] = useState(initialResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function diagnose() {
    setLoading(true); setError("");
    const response = await diagnoseQuestionMiss({ question, selectedChoice, patientInterpretation: patient, requestedTarget: ask, learnerPrediction: prediction }, { callAIJSON });
    setLoading(false);
    if (response.error) { setError(response.error); return; }
    setResult(response.diagnostic);
    onComplete?.(response.diagnostic);
  }
  if (result?.skipped) return <div className="mt-3 text-xs text-text-3">Reasoning diagnosis skipped; answer revealed.</div>;
  if (result) return <div className="mt-3 rounded-lg border border-accent/40 bg-bg p-3 text-sm" data-testid="miss-diagnosis">
    <div className="font-mono text-xs font-bold uppercase tracking-wider text-accent-text">Reasoning check · answer now revealed</div>
    <p className="mt-2"><b>Patient:</b> {result.patient}</p><p className="mt-1"><b>Ask:</b> {result.asksFor}</p>
    {result.preserved?.length > 0 && <p className="mt-1"><b>You had:</b> {result.preserved.join(" → ")}</p>}
    {result.breakPoint && <p className="mt-1"><b>Break point:</b> {result.breakPoint}</p>}
    {result.bridge && <p className="mt-1"><b>Missing bridge:</b> {result.bridge}</p>}
    <p className="mt-1"><b>Miss type:</b> {MISS_TYPE_LABELS[result.primaryType] || "Unclassified"}{result.secondaryType ? ` + ${MISS_TYPE_LABELS[result.secondaryType]}` : ""}</p>
    {result.choiceTrap && <p className="mt-1"><b>Why your choice tempted you:</b> {result.choiceTrap}</p>}
    {(question?.lectureId || question?.lectureIds?.[0]) && onNavigateToLecture && <div className="mt-3 rounded border border-accent/30 bg-accent/5 p-2"><p className="text-xs text-text-2">This miss is linked to a lecture. Open it for a fresh objective-focused repair quiz.</p><Button className="mt-2" variant="outline" onClick={() => onNavigateToLecture(question.lectureId || question.lectureIds[0])}>Open lecture repair</Button></div>}
    {result.anki?.kind !== "none" && result.anki?.front && <details className="mt-2"><summary className="cursor-pointer">Anki idea ({result.anki.kind})</summary><p className="mt-1"><b>Front:</b> {result.anki.front}</p><p><b>Back:</b> {result.anki.back}</p></details>}
  </div>;
  return <div className="mt-3 rounded-lg border border-border bg-bg p-3" data-testid="miss-diagnosis-form">
    <p className="text-sm font-semibold">Before seeing the answer, locate the reasoning break.</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-xs text-text-2">PATIENT · what is happening?<textarea className="mt-1 min-h-16 w-full rounded border border-border bg-bg-elevated p-2" value={patient} onChange={e => setPatient(e.target.value)} /></label><label className="text-xs text-text-2">ASK · what exact target is requested?<textarea className="mt-1 min-h-16 w-full rounded border border-border bg-bg-elevated p-2" value={ask} onChange={e => setAsk(e.target.value)} /></label></div>
    <label className="mt-2 block text-xs text-text-2">What did you predict before scanning choices? <input className="mt-1 w-full rounded border border-border bg-bg-elevated p-2" value={prediction} onChange={e => setPrediction(e.target.value)} /></label>
    {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
    <Button className="mt-2" onClick={diagnose} disabled={loading || !patient.trim() || !ask.trim()}>{loading ? "Finding the break…" : "Diagnose, then reveal answer"}</Button>
    <button type="button" onClick={onSkip} disabled={loading} className="ml-3 text-xs text-text-3 underline">Skip diagnosis and reveal</button>
  </div>;
}

function QuestionNavigator({ questions, session, currentIndex, onSelect, indices = questions.map((_, i) => i) }) {
  const selectedLabel = indices.length ? `question ${currentIndex + 1} selected` : "no question selected";
  return (
    <details className="mb-3 rounded-lg border border-border bg-bg-elevated p-2">
      <summary className="cursor-pointer px-1 py-1 text-sm font-medium text-text-2">
        Question navigator · {indices.filter(i => pickedFor(session, questions[i].questionId) != null).length}/{indices.length} answered · {selectedLabel}
      </summary>
      <nav aria-label="Question navigation" className="mt-2 flex flex-wrap gap-1.5">
        {indices.map(index => {
          const question = questions[index];
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

function ExamFormat({ controller, submitOpts, objectivesById, lectureLabelsByLectureId, userId, saveExitAction }) {
  const { session, currentIndex, setCurrentIndex, remainingMs, answerQuestion, submit, submitting } =
    controller;
  const questions = session.questions || [];
  const q = restoreVisualChoices(questions[currentIndex]);
  const answeredCount = (session.answers || []).filter(answer => answer.value != null).length;
  const targetQuestionCount = Math.max(questions.length, Number(session.targetQuestionCount) || questions.length);
  const incompleteDiagnostic = session.sourceType !== "question-bank" && targetQuestionCount > questions.length;
  const [textToolsTarget, setTextToolsTarget] = useState(null);
  const display = splitQuestionStemSource(q?.stem);
  const section = q ? (q.sourceSectionTitle || q.sourceSection || lectureLabelsByLectureId?.[q.lectureId] || q.topic || "Mixed block") : "";

  return (
    <div className="space-y-3" onKeyDown={(event) => advanceOnEnter(event, () => setCurrentIndex((i) => Math.min(questions.length - 1, i + 1)), !!q && pickedFor(session, q.questionId) != null && currentIndex < questions.length - 1 && !submitting)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-1 pb-3">
        <div className="min-w-0"><p className="font-mono text-xs uppercase tracking-wider text-accent-text">Question {currentIndex + 1} of {questions.length} · {answeredCount} answered</p><p className="mt-1 truncate text-sm font-semibold text-text-1">{section}</p></div>
        <div className="flex items-center gap-2"><div
          data-testid="exam-timer"
          className={
            "font-mono text-sm font-bold " + (remainingMs != null && remainingMs < 60_000 ? "text-bad" : "text-text-1")
          }
        >
          {formatClock(remainingMs)}
        </div><details className="relative" aria-label="Exam tools"><summary className="cursor-pointer rounded border border-border px-3 py-2 text-sm">⋯ Tools</summary><div className="absolute right-0 z-40 mt-2 w-[min(88vw,24rem)] space-y-2 rounded-lg border border-border bg-bg-elevated p-4 shadow-xl"><QuestionMeta question={q} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} /><div ref={setTextToolsTarget} /><p className="text-xs text-text-3">Click a highlighted phrase to remove only that highlight.</p></div></details></div>
      </div>

      {session.purpose==='reserved-assessment' && <p className="text-xs text-text-2">Reserved timed assessment · answers hidden until submission · unanswered questions count in the score. Saving and resuming retains the original deadline.</p>}
      <QuestionNavigator questions={questions} session={session} currentIndex={currentIndex} onSelect={setCurrentIndex} />

      {q && (
        <div className="rounded-lg bg-bg-elevated p-4 sm:p-5">
          <QuestionStem text={display.stem} questionId={q.questionId} toolsTarget={textToolsTarget} toolsInBody={false} />
          {session.purpose==='reserved-assessment' ? <ReservedAssessmentFigure question={q}/> : <SchoolQuestionFigure question={q} userId={userId} />}
          {display.sourceNote && <p className="mb-3 text-[11px] text-text-3">Figure source: {display.sourceNote.replace(/^Underlying\s+(?:schematic|image|figure)\s+from\s+/i, "")}</p>}
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
        {session.purpose==='reserved-assessment' && saveExitAction}
        <div><div className="text-xs font-bold text-text-1">{session.purpose==='reserved-assessment'?'Finish assessment':'Finished reviewing?'}</div><div className="font-mono text-[11px] text-text-3">{answeredCount} answered · {questions.length - answeredCount} {session.purpose==='reserved-assessment' ? "unanswered · counted in the assessment score" : session.sourceType === "question-bank" ? "unanswered · remain available in this set" : "return to reserve"}</div></div>
        <Button variant="outline" disabled={submitting || session.fillStatus === "generating"} onClick={() => {
          if (window.confirm(session.purpose==='reserved-assessment' ? `Submit this assessment? ${questions.length - answeredCount} unanswered questions will count in the assessment score.` : incompleteDiagnostic ? `Finish this incomplete practice set? ${questions.length}/${session.targetQuestionCount} requested questions were prepared; it will not count as a full diagnostic.` : `Submit ${answeredCount} answered questions for grading? ${questions.length - answeredCount} unanswered questions will not count against you.`)) submit(submitOpts);
        }}>{submitting ? "Grading answered questions…" : incompleteDiagnostic ? "Finish incomplete practice" : `Submit ${sessionLabel(session).toLowerCase()} · finish & grade`}</Button>
      </div>
    </div>
  );
}

function ExamStartGate({ session, onStart, onExit, onAbandon }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const ready = session.questions?.length || 0;
  const target = Math.max(ready, Number(session.targetQuestionCount) || ready);
  const incomplete = ready < target;
  const start = async () => {
    setStarting(true); setError("");
    try { await onStart(); }
    catch (cause) { setError(cause?.message || "Could not start the exam."); setStarting(false); }
  };
  return <div className="space-y-4">
    <SessionTitle session={session} />
    <section className="mx-auto max-w-2xl rounded-xl border border-border bg-bg-elevated p-5 sm:p-6">
      <p className="text-sm font-semibold text-accent-text">Preparation finished</p>
      <h2 className="mt-1 text-2xl font-bold text-text-1">{ready}/{target} questions ready</h2>
      <p className="mt-2 text-sm text-text-2">{incomplete ? "This is incomplete practice and will not count as a full diagnostic." : "Your exam is ready."} The countdown has not started.</p>
      <p className="mt-1 text-sm text-text-2">You will receive {Math.max(1, Number(session.durationMinutes) || ready * 1.5)} minutes beginning only after you press Start.</p>
      {session.fillError && <details className="mt-3 text-sm text-text-2"><summary className="cursor-pointer font-medium">Why some questions were not ready</summary><p className="mt-2 whitespace-pre-line">{session.fillError}</p></details>}
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-2"><Button onClick={start} disabled={starting}>{starting ? "Starting…" : incomplete ? `Start ${ready}-question incomplete practice` : "Start timed exam"}</Button>{onExit}{onAbandon}</div>
    </section>
  </div>;
}

// I1 fix — practice format previously had no submit control at all: the
// Next button just disabled itself with "Last question" once the final
// question was answered, so the only way to end a practice session was
// Abandon — which by design never finalizes (no recordAnswer/weak-concept
// writes), so practice results never reached stats or the dashboard. A
// "Finish" button, reachable once the last question is answered/revealed,
// calls the same `submit()` the controller already exposes for format
// "exam" — same function, now reachable from practice's UI too.
function PracticeFormat({ controller, tutorModeEnabled, submitOpts, callAI, userId, objectivesById, lectureLabelsByLectureId, onNavigateToLecture, saveExitAction, abandonAction }) {
  const { session, currentIndex, setCurrentIndex, answerQuestion, submit, submitting } = controller;
  const questions = session.questions || [];
  const focusStorageKey = `rxt-practice-sections:${userId}:${session.sessionId}`;
  const [selectedSections, setSelectedSections] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem(focusStorageKey) || '[]'); return Array.isArray(value) ? value.filter(v => typeof v === 'string') : []; } catch { return []; }
  });
  const sections = practiceSections(questions, session.answers, lectureLabelsByLectureId, protectSessionScoring(session, questionRatingsStore.read(userId).ratings));
  const effectiveSelection = selectedSections.filter(key => sections.some(s => s.key === key));
  const indices = sectionQuestionIndices(sections, effectiveSelection);
  const inFocus = effectiveSelection.length > 0;
  const focusIndex = indices.indexOf(currentIndex);
  const visibleIndex = focusIndex >= 0 ? currentIndex : firstSectionQuestion(indices, questions, session.answers);
  const position = indices.indexOf(visibleIndex);
  const q = restoreVisualChoices(questions[visibleIndex]);
  const display = splitQuestionStemSource(q?.stem);
  const focusAnswered = indices.filter(i => pickedFor(session, questions[i].questionId) != null).length;
  function selectSections(keys) {
    setSelectedSections(keys);
    try { localStorage.setItem(focusStorageKey, JSON.stringify(keys)); } catch { /* Optional navigation preference. */ }
    const next = sectionQuestionIndices(sections, keys);
    setCurrentIndex(firstSectionQuestion(next, questions, session.answers));
  }
  useEffect(() => {
    if (visibleIndex !== currentIndex) setCurrentIndex(visibleIndex);
  }, [visibleIndex, currentIndex, setCurrentIndex]);
  const picked = q ? pickedFor(session, q.questionId) : null;
  const savedAnswer = (session.answers || []).find(answer => answer.questionId === q?.questionId);
  const revealed = picked != null && savedAnswer?.revealed !== false;
  const toolsRef = useRef(null);
  const [textToolsTarget, setTextToolsTarget] = useState(null);
  const [reasonFirst, setReasonFirst] = useState(false);
  const isCorrect = revealed && !!q?.correct && picked === q.correct;
  const [diagnostics, setDiagnostics] = useState({});
  const diagnosed = !!diagnostics[q?.questionId];
  const showAnswer = revealed && (!reasonFirst || diagnosed);
  if (!q) return null; // Preparation status is shown once above the question area.

  return (
    <div className="space-y-3" onKeyDown={(event) => advanceOnEnter(event, () => setCurrentIndex(indices[position + 1]), picked != null && position < indices.length - 1 && !submitting)}>
      <header aria-label="Practice header" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{practiceSection(q,lectureLabelsByLectureId).title || practiceSection(q,lectureLabelsByLectureId).label}</p><p className="mt-1 text-xs text-text-2">Question {position + 1} of {indices.length} · {focusAnswered} answered</p></div>
        {saveExitAction}
        <details ref={toolsRef} className="relative" aria-label="Practice tools" onKeyDown={event=>{if(event.key==="Escape"){event.currentTarget.open=false;event.stopPropagation();}}}><summary className="cursor-pointer rounded border border-border px-3 py-2 text-sm" aria-label="Open practice tools">⋯ Tools</summary>
        <div className="absolute right-0 z-40 mt-2 max-h-[70vh] w-[min(88vw,42rem)] space-y-3 overflow-auto rounded-lg border border-border bg-bg-elevated p-4 shadow-xl">
          <SessionTitle session={session} />
      {session.sourceType === 'question-bank' && <section aria-label="Homework sections" className="rounded-lg border border-border bg-bg-elevated p-3">
        <p className="text-sm font-semibold">{inFocus ? 'Section focus' : 'Whole homework bank'} · {focusAnswered}/{indices.length} answered</p>
        <details className="mt-2 text-sm"><summary className="cursor-pointer">Choose lectures or sections</summary>
          <p className="mt-2 text-text-2">Select one or more source sections to work through first.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{sections.map(section => <label key={section.key} className="flex items-start gap-2 rounded border border-border p-2"><input type="checkbox" checked={effectiveSelection.includes(section.key)} onChange={event => selectSections(event.target.checked ? [...effectiveSelection, section.key] : effectiveSelection.filter(key => key !== section.key))} /><span><strong className="block">{section.title || section.label}</strong>{section.title && <span className="block text-xs text-text-3">{section.label}</span>}<span className="block text-text-2">{section.answered}/{section.indices.length} answered{section.answered === section.indices.length ? ' · ✓ Complete' : ''}</span><span className="block text-text-2">{section.accuracy == null ? 'No revealed scores yet' : `${section.accuracy}% correct · ${section.correct} right, ${section.scored - section.correct} wrong`}{section.pending > 0 ? ` · ${section.pending} saved without reveal` : ''}</span></span></label>)}</div>
        </details>
        {inFocus && <button type="button" className="mt-2 text-sm underline" onClick={() => selectSections([])}>Return to whole bank</button>}
        {inFocus && focusAnswered === indices.length && <p role="status" className="mt-2 text-sm font-semibold">✓ Selected sections complete. Choose another section or save and leave.</p>}
      </section>}
      <SourceBankRepair session={session} userId={userId} onRepaired={controller.refetch} />
      <QuestionNavigator questions={questions} indices={indices} session={session} currentIndex={visibleIndex} onSelect={index=>{setCurrentIndex(index);if(toolsRef.current)toolsRef.current.open=false;}} />

          <QuestionMeta question={q} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
          <LeadInCue stem={q.stem} />
          <div ref={setTextToolsTarget} />
          <label className="inline-flex items-center gap-2 text-xs text-text-2"><input type="checkbox" checked={reasonFirst} onChange={event => setReasonFirst(event.target.checked)} />Reason before reveal</label>
          <QuestionQualityRating userId={userId} question={q} />
          {abandonAction}
        </div></details>
      </header>
      <div className="rounded-lg border border-border bg-bg-elevated p-4">
        {q.sourceVisualChoicesUnverified && !q.sourceVisualLabelsConfirmed && <p role="status" className="mb-3 text-sm text-text-2">Diagram choice count is not confirmed. Confirm the labels using the source figure controls below; this item is excluded from scoring until confirmed.</p>}
        {!q.correct && <p role="status" className="mb-3 rounded border border-warn p-3 text-sm">Source key needs verification. This question is excluded from scoring; you can continue. {q.sourceKeyCritique}</p>}
        <QuestionStem text={display.stem} questionId={q.questionId} toolsTarget={textToolsTarget} toolsInBody={false} />
        <SchoolQuestionFigure question={q} userId={userId} onVisualLabels={async lastLetter => {
          if ('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(lastLetter) < Math.max(...Object.keys(q.choices).map(letter=>'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(letter)))) throw Error('Cannot remove existing source choices.');
          await updateExamSessionTransaction(userId,session.sessionId,current => {
            if(current?.status !== 'in_progress') return null;
            return {...current,questions:current.questions.map(item=>item.questionId===q.questionId ? {...item,choices:Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0,'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.indexOf(lastLetter)+1).split('').map(letter=>[letter,`Visual option ${letter}`])),sourceVisualLabelsConfirmed:true} : item)};
          });
          await questionFigures.save(userId,q,{visualLastLabel:lastLetter});
          await controller.refetch?.();
        }} />
        {display.sourceNote && <p className="mb-3 text-[11px] text-text-3">Figure source: {display.sourceNote.replace(/^Underlying\s+(?:schematic|image|figure)\s+from\s+/i, "")}</p>}
        {!revealed && session.purpose!=='reserved-assessment' && <HelpMeReason key={`${session.sessionId}:${q.questionId}`} question={q} userId={userId} initialState={q.reasoningCoach}
          onAssist={async()=>{const saved=await markReasoningAssistance(userId,session.sessionId,q.questionId);controller.syncCoaching?.(saved.questions.find(item=>item.questionId===q.questionId));}}
          onState={async coach=>{const saved=await saveReasoningCoach(userId,session.sessionId,q.questionId,coach);controller.syncCoaching?.(saved.questions.find(item=>item.questionId===q.questionId));}} />}
        {q.assistance?.used && <p className="mb-2 text-xs text-accent-text">Assisted answer · does not establish independent readiness.</p>}
        <ChoiceList
          questionId={q.questionId}
          choices={q.choices}
          choiceColumns={q.choiceColumns}
          choiceLayout={q.choiceLayout}
          picked={picked}
          revealed={showAnswer}
          locked={revealed && !showAnswer}
          correct={q.correct}
          onPick={letter => answerQuestion(q.questionId, letter, { revealed: false })}
        />

        {!revealed && (
          <div className="mt-3">
            <Button variant="outline" className="mr-2" disabled={!picked || submitting} onClick={() => {
              const saved = answerQuestion(q.questionId, picked, { revealed: false });
              if (saved !== false && position < indices.length - 1) setCurrentIndex(indices[position + 1]);
            }}>{position < indices.length - 1 ? 'Save answer & next' : 'Save answer without reveal'}</Button>
            <Button data-testid="check-answer" onClick={() => answerQuestion(q.questionId, picked, { revealed: true })} disabled={!picked}>
              Check answer
            </Button>
          </div>
        )}

        {!revealed && picked != null && !inFocus && visibleIndex === questions.length - 1 && session.fillStatus !== "generating" && <Button variant="outline" disabled={submitting} onClick={() => submit(submitOpts)}>Finish without revealing</Button>}

        {revealed && !showAnswer && <div className="space-y-2 rounded-lg border border-border p-3"><label className="block text-sm text-text-2">Your reasoning (optional)<textarea key={q.questionId} className="mt-1 block w-full rounded border border-border bg-panel p-2" rows={3} placeholder="What led you to this answer?" /></label><Button variant="outline" onClick={() => setDiagnostics(current => ({ ...current, [q.questionId]: { skipped: true } }))}>Reveal answer</Button></div>}

        {revealed && q.correct && !isCorrect && <details key={`diagnosis-${q.questionId}`} className="text-sm"><summary className="cursor-pointer py-2 text-text-3">Review this miss · optional</summary><MissDiagnosis question={q} selectedChoice={picked} initialResult={diagnostics[q.questionId]} onSkip={() => setDiagnostics(current => ({ ...current, [q.questionId]: { skipped: true } }))} onNavigateToLecture={onNavigateToLecture} onComplete={(diagnostic) => {
          recordMissType(userId, diagnostic.primaryType, `${session.sessionId}:${q.questionId}`);
          setDiagnostics(current => ({ ...current, [q.questionId]: diagnostic }));
        }} /></details>}

        {showAnswer && (
          <div className="mt-3 space-y-2">
            <div data-testid="practice-reveal" className={"text-xs " + (isCorrect ? "text-good" : "text-bad")}>
              {!q.correct ? "Unscored · source key needs verification" : isCorrect ? "✓ Correct" : "✕ Incorrect"}
            </div>
            {(q.explanation || Object.keys(q.whyWrong || {}).length > 0) && (
              <QuestionExplanation selectedLetter={picked} text={q.explanation} correctLetter={q.correct} whyWrong={q.whyWrong} choices={q.choices} sourceType={q.sourceType || session.sourceType} />
            )}
            {q.correct && !isCorrect && <LearningGapNote key={q.questionId} userId={userId} question={q} blockId={session.blockId} lectureId={q.lectureId} />}
            {tutorModeEnabled && <TutorPanelForQuestion question={q} callAI={callAI} />}
            {!inFocus && visibleIndex + 1 >= questions.length && session.fillStatus === "generating" ? (
              <div role="status" className="text-sm text-text-3">Your next question is being prepared…</div>
            ) : !inFocus && visibleIndex + 1 >= questions.length ? (
              <Button onClick={() => submit(submitOpts)} disabled={submitting}>
                {submitting ? "Submitting…" : "Finish"}
              </Button>
            ) : null}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={position <= 0} onClick={() => setCurrentIndex(indices[position - 1])}>← Prev</Button>
        <Button variant="outline" disabled={position >= indices.length - 1} onClick={() => setCurrentIndex(indices[position + 1])}>Next →</Button>
      </div>
      {inFocus && position === indices.length - 1 && <Button variant="outline" onClick={() => {
        const outside = questions.map((_,i)=>i).filter(i=>!indices.includes(i));
        selectSections([]);
        setCurrentIndex(outside.length ? firstSectionQuestion(outside,questions,session.answers) : visibleIndex);
      }}>Continue beyond selected sections →</Button>}
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
function SubmittedExamReview({ session, tutorModeEnabled, callAI, userId, objectivesById, lectureLabelsByLectureId, onNavigateToLecture, onTargetedRetest, retestBusy }) {
  const learningEvidence=useStoreResource(learnerEvidenceStore,userId);
  const [, refreshQuality] = useState(0);
  useEffect(() => questionRatingsStore.subscribe(() => refreshQuality(n => n + 1)), []);
  const questions = session.questions || [];
  // Start with the complete, PDF-like exam review; filters remain available
  // for focused remediation after the full set is visible.
  const [filter, setFilter] = useState("all");
  const [worksheetError, setWorksheetError] = useState("");
  const answered = questions.filter((q) => pickedFor(session, q.questionId) != null);
  const scoreableAnswered = answered.filter(q => !questionRatingsStore.isExcluded(userId, q));
  const correctCount = scoreableAnswered.filter((q) => pickedFor(session, q.questionId) === q.correct).length;
  const incorrectCount = scoreableAnswered.length - correctCount;
  const unlinkedMisses = scoreableAnswered.filter(q => !q.lectureId && pickedFor(session, q.questionId) !== q.correct).length;
  const scoreDenominator=session.purpose==='reserved-assessment' ? questions.filter(q=>!questionRatingsStore.isExcluded(userId,q) && !(session.scoringExcludedQuestionIds || []).includes(q.questionId)).length : scoreableAnswered.length;
  const percent = scoreDenominator ? Math.round(correctCount / scoreDenominator * 100) : 0;
  const targetQuestionCount = Math.max(questions.length, Number(session.targetQuestionCount) || questions.length);
  const incompleteDiagnostic = session.sourceType !== "question-bank" && targetQuestionCount > questions.length;
  const missingQuestionCount = Math.max(0, targetQuestionCount - questions.length);
  const visible = questions.filter((q) => {
    const picked = pickedFor(session, q.questionId);
    if (filter === "correct") return !questionRatingsStore.isExcluded(userId, q) && picked === q.correct;
    if (filter === "incorrect") return !questionRatingsStore.isExcluded(userId, q) && picked != null && picked !== q.correct;
    if (filter === "unused") return picked == null;
    return true;
  });
  const exportMissedQuestions = () => {
    const missed = questions.filter((q) => {
      const picked = pickedFor(session, q.questionId);
      return !questionRatingsStore.isExcluded(userId, q) && picked != null && picked !== q.correct;
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
          {correctCount}/{scoreableAnswered.length} correct · {percent}%{incompleteDiagnostic?' prepared-item accuracy':''}{answered.length > scoreableAnswered.length ? ` · ${answered.length - scoreableAnswered.length} excluded` : ""}
        </div>
      </div>
      {incompleteDiagnostic&&<div role="alert" className="rounded-lg border border-warn/50 bg-bg-elevated p-3 text-sm text-text-1"><strong>Incomplete diagnostic · {questions.length}/{targetQuestionCount} questions prepared.</strong><p className="mt-1 text-text-2">This attempt is reviewable practice, not a full diagnostic score, and is excluded from Exam accuracy and readiness.</p></div>}
      {lectureReviewSummary(protectSessionScoring(session, questionRatingsStore.read(userId).ratings), lectureLabelsByLectureId).length > 0 && <section className="rounded-lg border border-border p-3">
        <h3 className="font-semibold">Lectures to revisit after missed questions</h3>
        <p className="text-xs text-text-3">Only lectures with missed answers in this session appear here.</p>
        {!lectureReviewSummary(protectSessionScoring(session, questionRatingsStore.read(userId).ratings), lectureLabelsByLectureId).some(row => row.misses > 0) && <p className="mt-2 text-sm text-good">No misses in the linked lectures this session.</p>}
        <details className="mt-2 text-sm"><summary className="cursor-pointer text-text-3">Lectures with no misses this session</summary>{lectureReviewSummary(protectSessionScoring(session, questionRatingsStore.read(userId).ratings), lectureLabelsByLectureId).filter(row => row.misses === 0).map(row => <p key={row.lectureId} className="mt-1">{row.label} · {row.correct}/{row.answered} correct</p>)}</details>
        <ul className="mt-2 space-y-2">{lectureReviewSummary(protectSessionScoring(session, questionRatingsStore.read(userId).ratings), lectureLabelsByLectureId).filter(row => row.misses > 0).map(row => <li key={row.lectureId} className="text-sm"><strong>{row.label}</strong> · {row.correct}/{row.answered} correct · {row.misses ? `${row.misses} missed — review this lecture, then try fresh questions` : "No misses in this session"}{onNavigateToLecture && row.misses > 0 && <button type="button" className="ml-2 text-accent underline" onClick={() => onNavigateToLecture(row.lectureId)}>Review lecture</button>}</li>)}</ul>
      </section>}
      <ObjectiveLearningReport objectives={Object.values(objectivesById || {})} evidence={learningEvidence.data || {}}
        records={scoreableAnswered.filter(q=>!questionRatingsStore.isExcluded(userId,q,"objective")).map(q=>sessionEvidenceEvent(session,q,session.answers.find(a=>a.questionId===q.questionId)))}
        busy={retestBusy} onRetest={onTargetedRetest} />
      {unlinkedMisses > 0 && <p role="status" className="rounded-lg border border-warn/40 p-3 text-sm text-text-2">{unlinkedMisses} missed question{unlinkedMisses === 1 ? " is" : "s are"} saved but awaiting lecture links. These misses cannot yet identify a lecture to revisit.</p>}
      {incorrectCount > 0 && <div className="rounded-lg border border-accent/40 bg-bg-elevated p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-text-1">Take your missed questions to Goodnotes</div>
          <Button variant="outline" onClick={exportMissedQuestions}>Print / save worksheet as PDF</Button>
        </div>
        <p className="mt-1 text-xs text-text-3">Exports {incorrectCount} missed questions with their figures and full choices, plus space to reason. Answers are left out.</p>
        {worksheetError && <p role="alert" className="mt-2 text-xs text-bad">{worksheetError}</p>}
      </div>}
      <ReservedAssessmentReport session={session} excludedIds={questions.filter(q=>questionRatingsStore.isExcluded(userId,q)).map(q=>q.questionId)} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
      {session.purpose!=='reserved-assessment' && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[[incompleteDiagnostic?"Prepared accuracy":"Score", `${percent}%`], ["Correct", correctCount], ["Incorrect", incorrectCount], [incompleteDiagnostic?"Missing":"Unused", incompleteDiagnostic?missingQuestionCount:questions.length - answered.length]].map(([label, value]) => <div key={label} className="rounded-lg border border-border bg-panel p-3"><div className="font-mono text-[10px] uppercase text-text-3">{label}</div><div className="text-lg font-bold text-text-1">{value}</div></div>)}
      </div>}
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
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-accent-text">Question {questions.findIndex((item) => item.questionId === q.questionId) + 1} · {questionRatingsStore.isExcluded(userId, q) ? "Excluded · answer preserved" : picked == null ? "Unused" : picked === q.correct ? "✓ Correct" : "✕ Incorrect"}</h3>
              {context && <span className="text-xs text-text-3">{context}</span>}
            </div>
            <QuestionMeta question={q} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
            <QuestionStem text={q.stem} questionId={q.questionId} />
            <SchoolQuestionFigure question={q} userId={userId} />
            <ChoiceList questionId={q.questionId} choices={q.choices} choiceColumns={q.choiceColumns} choiceLayout={q.choiceLayout} picked={picked} revealed correct={q.correct} onPick={() => {}} />
            <div className="mt-2"><QuestionQualityRating userId={userId} question={q} /></div>
            {picked != null && picked !== q.correct && <LearningGapNote key={q.questionId} userId={userId} question={q} blockId={session.blockId} lectureId={q.lectureId} />}
            {picked != null && picked !== q.correct && <details><summary className="cursor-pointer py-2 text-sm text-text-3">Review this miss · optional</summary><MissReflection userId={userId} question={q} /><MissDiagnosis question={q} selectedChoice={picked} onNavigateToLecture={onNavigateToLecture} onComplete={(diagnostic) => {
              recordMissType(userId, diagnostic.primaryType, `${session.sessionId}:${q.questionId}`);
            }} /></details>}
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
  lectures = [],
  onNavigateToLecture,
  objectivesById = {},
  onExit,
  onSubmitted = null,
  onRecoverPreparation,
  onTargetedRetest,
  retestBusy = false,
  tutorModeEnabled = false,
  callAI,
}) {
  const controller = useExamSessionController(sessionId, userId);
  const [savingExit, setSavingExit] = useState(false);
  const [savedSitting, setSavedSitting] = useState(null);
  const sittingBaseline = useRef(null);
  const [exitError, setExitError] = useState(null);
  const { session: storedSession, loading, error, submit, abandon, submitResult, submitting, syncStatus } = controller;
  useEffect(() => {
    if (storedSession && sittingBaseline.current?.sessionId !== sessionId) sittingBaseline.current = { sessionId, answers: (storedSession.answers || []).map(a => ({ ...a })) };
  }, [storedSession, sessionId]);
  useEffect(() => {
    if (storedSession?.status === "submitted") onSubmitted?.(storedSession);
  }, [storedSession, onSubmitted]);

  const session = useMemo(() => storedSession ? { ...storedSession, questions: (storedSession.questions || []).map(q => q.sourceType === "question-bank" ? linkSourceLecture(q, lectures, q.sourceBlockId || q.blockId || storedSession.blockId) : q) } : null, [storedSession, lectures]);

  useEffect(() => {
    if (session?.status !== "in_progress") return;
    return quietBackgroundJobs();
  }, [session?.status]);
  useEffect(() => {
    if (!session || !onRecoverPreparation) return;
    const resume = () => onRecoverPreparation(session);
    resume();
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    const timer = setInterval(resume, 60000);
    return () => { window.removeEventListener("online", resume); window.removeEventListener("focus", resume); clearInterval(timer); };
  }, [session, onRecoverPreparation]);

  // I6 fix — `finalizeExamSession`'s `blockName`/`lectureLabelsByLectureId`
  // options were threaded correctly through finalize.js/finalizeLogic.js,
  // but `submit()` was called with no arguments at every call site here, so
  // every exam-derived weak-concept entry got a raw lectureId as its display
  // label forever. These come from ExamContainer (which already builds
  // `lecturesById`) via props, and are passed into every `submit()` call.
  const submitOpts = { blockName, lectureLabelsByLectureId, ...(lectures.length ? { lectures } : {}) };

  // Resume-on-mount: a session left in "finalizing" (a prior submit call was
  // interrupted before completing) shows a distinct "finishing up" state and
  // the component's job — not the hook's — is to call submit() again; safe
  // per Task 7's idempotent/resumable design.
  useEffect(() => {
    if (session?.status === "finalizing") submit(submitOpts);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Follow finalizing transitions, not submit identity changes.
  }, [session?.status]);

  if (loading) return <div className="text-sm text-text-3">Loading session…</div>;
  if (error) return <div className="text-sm text-bad">{error}</div>;
  if (!session) return <div className="text-sm text-text-3">Session not found.</div>;

  if (savedSitting && savedSitting.sessionId === sessionId) return <SavedPracticeSummary session={savedSitting} baseline={sittingBaseline.current?.answers || []} userId={userId} labels={lectureLabelsByLectureId} onExit={onExit} onResume={() => { sittingBaseline.current = { sessionId, answers: (savedSitting.answers || []).map(a => ({ ...a })) }; setSavedSitting(null); }} onNavigateToLecture={onNavigateToLecture} />;

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
    const incompleteDiagnostic = session.sourceType !== "question-bank" && (Number(session.targetQuestionCount) || session.questions?.length || 0) > (session.questions?.length || 0);
    return (
      <div className="space-y-3">
        <SessionTitle session={session} />
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-lg border border-border bg-bg-elevated p-2 shadow-sm"><div className="text-sm font-bold text-text-1">{incompleteDiagnostic?'Incomplete practice saved.':`Submitted. ${sessionLabel(session)} saved and graded.`}</div>{onExit && <Button onClick={onExit}>Done</Button>}</div>
        {(session.questions || []).length > 0 && (
          <SubmittedExamReview onTargetedRetest={onTargetedRetest} retestBusy={retestBusy} session={session} tutorModeEnabled={tutorModeEnabled} callAI={callAI} userId={userId} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} onNavigateToLecture={onNavigateToLecture} />
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

  const saveExitAction = onExit && <Button variant="outline" disabled={savingExit} onClick={async () => {
            setSavingExit(true); setExitError(null);
            try {
              const saved = await controller.saveProgress(submitOpts);
              if (session.sourceType === "question-bank" && session.format === "practice") setSavedSitting(saved || session);
              else onExit();
            }
            catch (error) { setExitError(error?.message || "Could not save your position. Please retry."); }
            finally { setSavingExit(false); }
          }}>{savingExit ? "Saving…" : "Save & exit"}</Button>;
  const abandonAction = <Button variant="ghost" onClick={async () => {
            if (typeof window !== "undefined" && !window.confirm("Abandon this session? Unanswered questions will return to your reserve.")) return;
            await abandon();
            onExit?.();
          }}>Abandon session</Button>;

  if (session.format === "exam" && session.fillStatus === "generating") {
    return <div className="mb-5 space-y-4"><SessionTitle session={session} /><ExamPreparationStatus session={session} /><p className="text-sm text-text-2">Questions stay hidden and the timer remains paused until preparation finishes and you choose Start.</p><div className="flex flex-wrap gap-2">{saveExitAction}{abandonAction}</div>{exitError && <p role="alert" className="text-sm text-bad">{exitError}</p>}</div>;
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
  if (session.format === "exam" && session.startedAt == null && session.deadline == null) {
    return <ExamStartGate session={session} onStart={controller.startExam} onExit={saveExitAction} onAbandon={abandonAction} />;
  }
  return (
    <div className="mb-5 space-y-3">
      {session.format === 'exam' && <SessionTitle session={session} />}
      {session.fillStatus === "partial" && <div role="alert" className="rounded-lg border border-warn/50 bg-bg-elevated p-3 text-sm text-text-2"><strong>{session.questions?.length || 0}/{session.targetQuestionCount || session.questions?.length || 0} questions prepared.</strong> You may review these as practice, but the result will be marked incomplete and will not count as a full diagnostic.</div>}
      {session.format === "exam" ? (
        <ExamFormat saveExitAction={saveExitAction} userId={userId} controller={{ ...controller, session }} submitOpts={submitOpts} objectivesById={objectivesById} lectureLabelsByLectureId={lectureLabelsByLectureId} />
      ) : (
        <PracticeFormat
          key={`${userId}:${session.sessionId}`}
          saveExitAction={saveExitAction}
          abandonAction={abandonAction}
          controller={{ ...controller, session }}
          tutorModeEnabled={tutorModeEnabled}
          submitOpts={submitOpts}
          callAI={callAI}
          userId={userId}
          objectivesById={objectivesById}
          lectureLabelsByLectureId={lectureLabelsByLectureId}
          onNavigateToLecture={onNavigateToLecture}
        />
      )}
      <div className="flex items-center justify-between">
        <SyncIndicator status={syncStatus} />
        <div className="flex gap-2">
          {exitError && <p role="alert" className="text-sm text-bad">{exitError}</p>}
          {session.format === 'exam' && saveExitAction}
          {session.format === 'exam' && abandonAction}
        </div>
      </div>
    </div>
  );
}
