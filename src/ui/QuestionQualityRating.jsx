import { useEffect, useState } from "react";
import * as ratingsStore from "../stores/questionRatings.js";

const ISSUES = [
  ["inaccurate", "Inaccurate"], ["ambiguous", "Ambiguous"], ["answer-leak", "Answer leaked"],
  ["repetitive", "Repetitive"], ["weak-vignette", "Weak vignette"], ["poor-distractors", "Poor distractors"],
];

export function QuestionQualityRating({ userId, question, onChange }) {
  const [rating, setRating] = useState(() => ratingsStore.ratingFor(userId, question) || {});
  const [note, setNote] = useState(() => ratingsStore.ratingFor(userId, question)?.sourceNote || "");
  const [reporting, setReporting] = useState(false);
  useEffect(() => { setRating(ratingsStore.ratingFor(userId, question) || {}); setReporting(false); setNote(ratingsStore.ratingFor(userId, question)?.sourceNote || ""); }, [userId, question]);
  if (!question) return null;
  const update = (patch) => {
    const next = ratingsStore.rateQuestion(userId, question, patch) || { ...rating, ...patch };
    setRating(next); onChange?.(next);
  };
  const toggle = (field, value) => update({ [field]: value });
  return (
    <div className="rounded border border-border bg-bg p-2.5" data-testid="question-quality-rating">
      <details className="mb-2">
        <summary className="cursor-pointer text-sm font-semibold">⚑ Question/Source Issue{rating.sourceIssue ? " · contested" : ""}</summary>
        <p className="my-2 text-xs text-text-2">Flag a problem with the question, independently of your answer. Contested items are excluded from objective evidence until you undo the flag.</p>
        <div className="flex flex-wrap gap-2">{[
          ["source-framing", "Source framing"], ["ambiguous", "Ambiguous"], ["unsupported", "Unsupported by lecture"],
          ["incorrect-key", "Incorrect key/explanation"], ["other", "Other"],
        ].map(([value, label]) => <button type="button" key={value} aria-pressed={rating.sourceIssue === value} onClick={() => update({ sourceIssue: value })} className="rounded border border-border px-2 py-1 text-xs">{label}</button>)}</div>
        {rating.sourceIssue && <div className="mt-2 space-y-2">
          <textarea aria-label="Question source issue note" placeholder="Optional note for review" value={note} onChange={event => setNote(event.target.value.slice(0, 1000))} onBlur={() => update({ sourceNote: note })} className="w-full rounded border border-border bg-bg p-2 text-sm" />
          <button type="button" onClick={() => { setNote(""); update({ sourceIssue: null, sourceNote: "" }); }} className="text-xs underline">Undo flag · restore eligibility</button>
        </div>}
      </details>
      {question.generationVersion && <><div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wide text-text-2">Rate this {question.generationVersion} question <span className="font-normal normal-case text-text-3">· optional</span></span>
        {rating.fair != null && rating.examStyle != null && <span className="text-[11px] font-semibold text-good">✓ Rated</span>}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        {[['fair', 'Fair and answerable?'], ['examStyle', 'Feels like ExamSoft?']].map(([field, label]) => (
          <div key={field} className="flex items-center gap-1"><span className="text-text-2">{label}</span>{[[true, "Yes"], [false, "No"]].map(([value, text]) => <button key={text} type="button" aria-pressed={rating[field] === value} onClick={() => toggle(field, value)} className={`rounded border px-2 py-1 ${rating[field] === value ? "border-accent bg-accent/15 text-text-1" : "border-border text-text-3"}`}>{text}</button>)}</div>
        ))}
        <button type="button" onClick={() => setReporting((value) => !value)} className="text-text-3 underline hover:text-text-1">{rating.issue ? `Issue: ${rating.issue}` : "Report issue"}</button>
      </div>
      {reporting && <div className="mt-2 flex flex-wrap gap-1.5">{ISSUES.map(([value, label]) => <button key={value} type="button" aria-pressed={rating.issue === value} onClick={() => { update({ issue: rating.issue === value ? null : value }); setReporting(false); }} className={`rounded border px-2 py-1 text-[11px] ${rating.issue === value ? "border-bad text-text-1" : "border-border text-text-3"}`}>{label}</button>)}</div>}
      </>}
    </div>
  );
}
