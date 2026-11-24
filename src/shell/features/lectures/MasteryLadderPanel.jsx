import { useMemo, useState } from "react";
import { blockLadderSummary, LADDER_RUNGS } from "../../../engine/masteryLadder.js";

const STEP_LABEL = { recall: "Recall question", application: "Application case", discrimination: "Look-alike discrimination", integration: "Two-step integration", retention: "Delayed retest" };
const SYMBOL = ["○", "◔", "◑", "◕", "●", "✓"];

/** Per-objective mastery ladder for one lecture (text + symbols, never color alone). */
export function MasteryLadderPanel({ objectives = [], evidence = {}, examDate = null, now: nowProp = null }) {
  const [mountedAt] = useState(() => Date.now());
  const now = nowProp ?? mountedAt;
  const summary = useMemo(() => blockLadderSummary(objectives, evidence, { now, examDate }), [objectives, evidence, now, examDate]);
  if (!objectives.length) return null;
  const mastered = summary.counts[5], integrated = summary.counts[4] + summary.counts[5];
  return <details className="w-full rounded-xl border border-border bg-bg-elevated p-4 shadow-sm" open>
    <summary className="cursor-pointer py-2 font-semibold">Mastery ladder · {mastered}/{objectives.length} mastered · {integrated}/{objectives.length} at Integration or above</summary>
    <p className="my-2 text-sm text-text-2">Recall → Application (2 in a row) → Discrimination (2, one confident) → Integration → Mastered after a correct retest on a later day. Only independent answers count; a miss drops one rung and the next quiz repairs it.</p>
    <ul className="space-y-2 text-sm">{summary.rows.sort((a, b) => a.ladder.rung - b.ladder.rung).map(({ objective, ladder }) => <li key={objective.id} className="border-t border-border pt-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>{objective.code ? <strong>{String(objective.code).split(".").slice(-2).join(".")} </strong> : null}{objective.objective || objective.text}</span>
        <span className="font-mono text-xs" aria-label={`Rung ${ladder.rung} of 5: ${ladder.label}`}>{SYMBOL[ladder.rung]} {ladder.label}{ladder.progress ? ` ${ladder.progress}` : ""}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1" aria-hidden="true">{LADDER_RUNGS.slice(1).map(r => <span key={r.rung} className={`rounded border px-1.5 py-0.5 text-[11px] ${ladder.rung >= r.rung ? "border-accent font-semibold" : "border-border text-text-3"}`}>{ladder.rung >= r.rung ? "✓ " : ""}{r.label}</span>)}</div>
      {ladder.next && <p className="mt-1 text-text-2">
        {ladder.repairDue ? "⚠ Repair: " : "Next: "}{STEP_LABEL[ladder.next.step] || ladder.next.step}
        {ladder.next.step === "retention" && ladder.retestDueAt ? (ladder.retestDue ? " · due now" : ` · due ${new Date(ladder.retestDueAt).toLocaleDateString()}`) : ""}
      </p>}
    </li>)}</ul>
  </details>;
}
