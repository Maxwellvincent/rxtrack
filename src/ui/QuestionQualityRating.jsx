import { useState } from "react";
import * as ratingsStore from "../stores/questionRatings.js";

const ISSUES = [
  ["inaccurate", "Inaccurate"], ["ambiguous", "Ambiguous"], ["answer-leak", "Answer leaked"],
  ["repetitive", "Repetitive"], ["weak-vignette", "Weak vignette"], ["poor-distractors", "Poor distractors"],
];

export function QuestionQualityRating({ userId, question }) {
  const [rating, setRating] = useState(() => ratingsStore.ratingFor(userId, question) || {});
  const [reporting, setReporting] = useState(false);
  if (!userId || !question?.generationVersion || question.generationMode === "grounded-fallback") return null;
  const update = (patch) => setRating(ratingsStore.rateQuestion(userId, question, patch) || { ...rating, ...patch });
  const toggle = (field, value) => update({ [field]: value });
  return (
    <div className="rounded border border-border bg-bg p-2.5" data-testid="question-quality-rating">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
    </div>
  );
}
