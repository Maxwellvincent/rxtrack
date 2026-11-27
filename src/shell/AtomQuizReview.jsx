import { Button } from "../ui/Button.jsx";
import { ChoiceValue } from "../ui/ChoiceValue.jsx";
import { QuestionExplanation } from "../ui/QuestionExplanation.jsx";
import { orderedChoiceEntries } from "./features/exam/choiceOrder.js";

/** The answered record for question `index`: matched by its saved index, else by order. */
export function recordForQuestion(records = [], index) {
  return records.find(record => record?.questionIndex === index) || (records.every(record => record?.questionIndex == null) ? records[index] : null) || null;
}

/**
 * Read-only look back at an answered lecture-quiz question: the choices with
 * your pick and the key marked, your confidence, and the explanation.
 */
export function AtomQuizReview({ question, record, index, total, canPrev, canNext, onPrev, onNext, onBack }) {
  const picked = record?.picked ?? null;
  return <section aria-label={`Review of question ${index + 1}`} className="quiz-question-card rounded-lg border border-border bg-bg-elevated p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <p className="font-mono text-xs uppercase tracking-wider text-text-3">Reviewing question {index + 1} of {total} · answered</p>
      <Button variant="outline" className="px-3 py-1 text-xs" onClick={onBack}>Back to current question →</Button>
    </div>
    <p className="quiz-stem mb-3 whitespace-pre-wrap text-sm text-text-1">{question.stem}</p>
    <ul className="space-y-2">
      {orderedChoiceEntries(question.choices || {}).map(([letter, value]) => {
        const isKey = letter === question.correct, isPick = letter === picked;
        return <li key={letter} className={`rounded border px-3 py-2 text-sm ${isKey ? "border-good" : isPick ? "border-bad" : "border-border"}`}>
          <span className="font-semibold">{letter}.</span> <ChoiceValue value={value} />
          {isKey && <span className="ml-2 text-xs font-semibold text-good">✓ Correct answer</span>}
          {isPick && !isKey && <span className="ml-2 text-xs font-semibold text-bad">✕ Your answer</span>}
          {isPick && isKey && <span className="ml-2 text-xs font-semibold text-good">· Your answer</span>}
        </li>;
      })}
    </ul>
    <p className="mt-2 text-xs text-text-2">
      {record ? `${record.correct ? "✓ Correct" : "✕ Incorrect"}${record.confidence ? ` · confidence ${record.confidence}/5` : ""}${picked == null ? " · your pick was not saved for this question" : ""}` : "Answer details unavailable."}
    </p>
    {(question.explanation || Object.keys(question.whyWrong || {}).length > 0) && <div className="mt-3">
      <QuestionExplanation notesInline selectedLetter={picked} text={question.explanation} correctLetter={question.correct} whyWrong={question.whyWrong} choices={question.choices} sourceType={question.sourceType} />
    </div>}
    <div className="mt-3 flex items-center justify-between">
      <Button variant="outline" disabled={!canPrev} onClick={onPrev}>← Prev</Button>
      <Button variant="outline" disabled={!canNext} onClick={onNext}>Next →</Button>
    </div>
  </section>;
}
