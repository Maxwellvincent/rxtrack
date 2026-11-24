import { useMemo, useState } from "react";
import { blockHighYield } from "../../../engine/blockHighYield.js";

/** What this block's school questions and score reports say to focus on. */
export function HighYieldPanel({ blockId, blockName = "", lectures = [], objectives = [], banks = [], weakConcepts = {}, onOpenLecture = null }) {
  const [expanded, setExpanded] = useState(false);
  const result = useMemo(() => blockHighYield({
    blockId, lectures, objectives, weakConcepts,
    banks: Object.fromEntries(banks.map(bank => [bank.filename, bank.questions])),
    bankMeta: Object.fromEntries(banks.map(bank => [bank.filename, { filename: bank.filename, blockId, sourceKind: bank.sourceKind }])),
  }), [blockId, lectures, objectives, banks, weakConcepts]);
  const { coverage } = result;
  const linkedShare = coverage.schoolQuestions ? Math.round((coverage.linkedToObjective + coverage.linkedToLecture) / coverage.schoolQuestions * 100) : 0;
  const shown = expanded ? result.lectures : result.lectures.slice(0, 6);
  const objectiveText = id => result.objectives.find(row => row.id === id);

  return <section className="mb-4 rounded-xl border border-border bg-bg-elevated p-4">
    <h2 className="text-lg font-semibold">High yield for {blockName || "this block"}</h2>
    <p className="mt-1 text-sm text-text-2">Ranked from your uploaded school questions (ESoft ×3, IMCQ ×2, homework ×1; clickers excluded), score-report weak areas and objectives you have not mastered.</p>
    {!coverage.schoolQuestions && <p className="mt-2 text-sm">◇ No school questions are uploaded for this block yet, so emphasis can’t be measured. Upload homework, IMCQs and ESoft quizzes under Banks.</p>}
    {coverage.schoolQuestions > 0 && <p className={`mt-2 text-sm ${linkedShare < 60 ? "font-semibold" : ""}`}>
      {linkedShare < 60 ? "⚠" : "✓"} {coverage.linkedToObjective + coverage.linkedToLecture} of {coverage.schoolQuestions} school questions are linked ({linkedShare}%).
      {coverage.unlinked > 0 && ` ${coverage.unlinked} still unlinked — link one question per homework heading under Banks → “Assign questions to lectures” and the rest of that heading follows.`}
    </p>}
    {result.taskKinds.some(kind => kind.schoolScore > 0) && <div className="mt-3 text-sm">
      <p className="font-semibold">What the school asks you to do</p>
      <ul className="mt-1 flex flex-wrap gap-2">{result.taskKinds.filter(kind => kind.schoolScore > 0).map(kind => <li key={kind.kind} className="rounded border border-border px-2 py-0.5">{kind.kind} · {kind.schoolScore} pts · {kind.objectives} objectives</li>)}</ul>
    </div>}
    {result.lectures.length > 0 && <ol className="mt-3 space-y-2 text-sm">{shown.map((lecture, index) => <li key={lecture.lectureId} className="rounded border border-border p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong>{index + 1}. {lecture.title}</strong>
        {onOpenLecture && <button type="button" className="text-xs underline" onClick={() => onOpenLecture(lecture.lectureId)}>Open lecture</button>}
      </div>
      <p className="text-text-2">{lecture.reportWeak ? "⚠ " : ""}{lecture.reasons.join(" · ")}</p>
      {lecture.topObjectives.length > 0 && <ul className="mt-1 list-disc pl-5 text-text-2">{lecture.topObjectives.map(row => {
        const full = objectiveText(row.id);
        const tally = Object.entries(full.counts).map(([tier, n]) => `${n} ${tier}`).join(", ");
        return <li key={row.id}>{full.status === "mastered" ? "✓ " : full.status === "struggling" ? "⚠ " : "◇ "}{full.text} <span className="text-text-3">({tally})</span></li>;
      })}</ul>}
    </li>)}</ol>}
    {result.lectures.length > 6 && <button type="button" className="mt-2 text-sm underline" onClick={() => setExpanded(value => !value)}>{expanded ? "Show top 6" : `Show all ${result.lectures.length}`}</button>}
    <p className="mt-2 text-xs text-text-3">✓ mastered · ⚠ struggling or weak on a score report · ◇ untested. Emphasis counts only exact objective codes and confirmed links, so it grows as you link questions.</p>
  </section>;
}
