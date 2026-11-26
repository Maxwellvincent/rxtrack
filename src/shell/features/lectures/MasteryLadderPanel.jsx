import { useMemo, useState } from "react";
import { blockLadderSummary, LADDER_RUNGS } from "../../../engine/masteryLadder.js";

const STEP_LABEL = { parts: "Untested parts", recall: "Recall question", application: "Application case", discrimination: "Look-alike discrimination", integration: "Two-step integration", retention: "Delayed retest" };
const SYMBOL = ["○", "◔", "◑", "◕", "●", "✓"];

/** One-line ladder tally for headers: ✓ mastered · ● integration · … plus repairs and retests due. */
export function LadderSummaryLine({ objectives = [], evidence = {}, examDate = null, now: nowProp = null, className = "" }) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  const summary = useMemo(() => blockLadderSummary(objectives, evidence, { now, examDate }), [objectives, evidence, now, examDate]);
  if (!objectives.length) return null;
  const repairs = summary.rows.filter(row => row.ladder.repairDue).length;
  const due = summary.rows.filter(row => row.ladder.retestDue).length;
  return <span className={className} aria-label={`Mastery ladder: ${summary.counts[5]} of ${objectives.length} mastered`}>
    <span className="font-mono">✓ {summary.counts[5]} · ● {summary.counts[4]} · ◕ {summary.counts[3]} · ◑ {summary.counts[2]} · ◔ {summary.counts[1]} · ○ {summary.counts[0]}</span>
    {repairs > 0 && <span className="ml-2">⚠ {repairs} to repair</span>}
    {due > 0 && <span className="ml-2">⏰ {due} retest{due === 1 ? "" : "s"} due</span>}
  </span>;
}

/** Per-objective mastery ladder for one lecture (text + symbols, never color alone). */
export function MasteryLadderPanel({ objectives = [], evidence = {}, examDate = null, now: nowProp = null, defaultOpen = false }) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  const summary = useMemo(() => blockLadderSummary(objectives, evidence, { now, examDate }), [objectives, evidence, now, examDate]);
  if (!objectives.length) return null;
  const mastered = summary.counts[5], integrated = summary.counts[4] + summary.counts[5];
  const repairs = summary.rows.filter(row => row.ladder.repairDue).length;
  const due = summary.rows.filter(row => row.ladder.retestDue).length;
  return <details open={defaultOpen || undefined} className="my-3 w-full rounded-xl border border-border bg-bg-elevated px-4 py-2 shadow-sm">
    <summary className="cursor-pointer py-1 text-sm">
      <span className="font-semibold">Mastery ladder</span>
      <span className="ml-2 font-mono text-xs text-text-2">✓ {mastered} · ● {integrated - mastered} · ◕ {summary.counts[3]} · ◑ {summary.counts[2]} · ◔ {summary.counts[1]} · ○ {summary.counts[0]}</span>
      {repairs > 0 && <span className="ml-2 text-xs">⚠ {repairs} to repair</span>}
      {due > 0 && <span className="ml-2 text-xs">⏰ {due} retest{due === 1 ? "" : "s"} due</span>}
      <span className="sr-only"> — {mastered} of {objectives.length} mastered</span>
    </summary>
    <p className="my-2 text-sm text-text-2">Recall → Application (2 in a row) → Discrimination (2, one confident) → Integration → Mastered after a correct retest on a later day. An objective that covers several lecture parts (✓ tested · ○ untested) also needs one correct answer on each part. Only independent answers count; a miss drops one rung and the next quiz repairs it.</p>
    <ul className="space-y-2 text-sm">{summary.rows.sort((a, b) => a.ladder.rung - b.ladder.rung).map(({ objective, ladder }) => <li key={objective.id} className="border-t border-border pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>{objective.code ? <strong>{String(objective.code).split(".").slice(-2).join(".")} </strong> : null}{objective.objective || objective.text}</span>
        <span className="font-mono text-xs" aria-label={`Rung ${ladder.rung} of 5: ${ladder.label}`}>{SYMBOL[ladder.rung]} {ladder.label}{ladder.progress ? ` ${ladder.progress}` : ""}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1" aria-hidden="true">{LADDER_RUNGS.slice(1).map(r => <span key={r.rung} className={`rounded border px-1.5 py-0.5 text-[11px] ${ladder.rung >= r.rung ? "border-accent font-semibold" : "border-border text-text-3"}`}>{ladder.rung >= r.rung ? "✓ " : ""}{r.label}</span>)}</div>
      {objective._parts?.length > 1 && <p className="mt-1 text-xs text-text-2" aria-label={`Parts tested: ${objective._parts.filter(part => part.covered).length} of ${objective._parts.length}`}>
        Parts {objective._parts.filter(part => part.covered).length}/{objective._parts.length}: {objective._parts.map(part => `${part.covered ? "✓" : "○"} ${part.label}`).join(" · ")}
      </p>}
      {ladder.next && <p className="mt-1 text-text-2">
        {ladder.repairDue ? "⚠ Repair: " : "Next: "}{STEP_LABEL[ladder.next.step] || ladder.next.step}
        {ladder.next.step === "retention" && ladder.retestDueAt ? (ladder.retestDue ? " · due now" : ` · due ${new Date(ladder.retestDueAt).toLocaleDateString()}`) : ""}
      </p>}
    </li>)}</ul>
  </details>;
}
