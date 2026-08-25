/**
 * Anki Struggle Tracker → RxTrack todo panel.
 *
 * One-way sync: Struggle Tracker addon exports deep/persistent cards + buried
 * remediation cards to a JSON file, scripts/sync-struggle-tracker.mjs pushes
 * it to users/{uid}/struggleTasks. "Done" here only sets doneLocally in
 * Firestore — it never writes back to Anki. Go clear/fix the card in Anki
 * itself when you actually resolve it; the next sync drops it from the list.
 */
import { useMemo, useState } from "react";
import { useStruggleTasks } from "../../hooks/useStruggleTasks.js";
import { releaseStruggleTask, setStruggleTaskDone } from "../../../supabase.js";
import { STATE_RANK, filterTasksToBlock, groupStruggleTasks } from "./struggleTasks.js";

const STATE_BADGE = {
  persistent: { icon: "🔴", label: "Persistent" },
  deep: { icon: "🟠", label: "Deep Review" },
  watch: { icon: "🟡", label: "Watch" },
};

const REMEDIATION_BADGE = {
  think: { icon: "🧠", label: "Deep Think" },
  notstudied: { icon: "📚", label: "Not Studied Yet" },
  draw: { icon: "✍️", label: "Draw / Work It Out" },
};

function TaskRow({ task, onToggleDone, onRelease }) {
  const state = STATE_BADGE[task.state];
  const remediation = REMEDIATION_BADGE[task.remediation];
  return (
    <div className="flex items-start gap-3 border-b border-border py-2.5 last:border-b-0">
      <input
        type="checkbox"
        checked={!!task.doneLocally}
        onChange={(e) => onToggleDone(task.id, e.target.checked)}
        className="mt-1 h-3.5 w-3.5 accent-accent"
        title="Mark done here (does not change the card in Anki)"
      />
      <div className={"flex-1 min-w-0" + (task.doneLocally ? " opacity-40" : "")}>
        <div className="flex flex-wrap items-baseline gap-2">
          {state && (
            <span className="font-mono text-[12px]">
              {state.icon} {state.label}
            </span>
          )}
          {remediation && (
            <span className="font-mono text-[12px]">
              {remediation.icon} {remediation.label}
            </span>
          )}
          <span className="text-sm text-text-1">{task.concept || "Unclassified concept"}</span>
        </div>
        {task.front && (
          <div className="mt-0.5 truncate text-[12px] text-text-3" title={task.front}>
            {task.front}
          </div>
        )}
        {task.reason && <div className="mt-0.5 font-mono text-[12px] text-text-2">{task.reason}</div>}
        <div className="mt-0.5 font-mono text-[11px] text-text-3">
          {[task.lecture, task.deck].filter(Boolean).join(" · ")}
        </div>
      </div>
      {task.doneLocally && onRelease && (
        <button
          type="button"
          onClick={() => onRelease(task.id)}
          className="shrink-0 rounded border border-border px-2 py-1 font-mono text-[12px] text-text-2 hover:border-accent hover:text-text-1"
          title="Remove this completed task from RXtrack and Focus HUD"
        >
          release
        </button>
      )}
    </div>
  );
}

function OcclusionGroupRow({ tasks, onToggleDone, onRelease }) {
  const [expanded, setExpanded] = useState(false);
  const head = tasks[0];
  const state = tasks.reduce(
    (best, t) => (STATE_RANK[t.state] > STATE_RANK[best] ? t.state : best),
    tasks[0].state
  );
  const badge = STATE_BADGE[state];
  const allDone = tasks.every((t) => t.doneLocally);

  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={allDone}
          onChange={(e) => tasks.forEach((t) => onToggleDone(t.id, e.target.checked))}
          className="mt-1 h-3.5 w-3.5 accent-accent"
          title="Mark all occlusion cards for this image done here"
        />
        <button
          onClick={() => setExpanded((v) => !v)}
          className={"flex-1 min-w-0 text-left" + (allDone ? " opacity-40" : "")}
        >
          <div className="flex flex-wrap items-baseline gap-2">
            {badge && (
              <span className="font-mono text-[12px]">
                {badge.icon} {badge.label}
              </span>
            )}
            <span className="text-sm text-text-1">{head.concept || "Unclassified concept"}</span>
            <span className="font-mono text-[12px] text-text-3">
              🖼️ {tasks.length} occlusion cards {expanded ? "▲" : "▼"}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-text-3">
            {[head.lecture, head.deck].filter(Boolean).join(" · ")}
          </div>
        </button>
      </div>
      {expanded && (
        <div className="ml-6 mt-1 border-l border-border pl-3">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onToggleDone={onToggleDone} onRelease={onRelease} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StruggleTasks({ userId, lectures = [], onBack }) {
  const { tasks: allTasks, loading } = useStruggleTasks(userId);
  const [showDone, setShowDone] = useState(false);
  // Synced Anki tasks carry no RXTrack blockId, only a deck-path/lecture
  // label — every card ever synced showed up regardless of which block was
  // open. Defaults scoped; "everything" is the real cross-block view for
  // comprehensive/Step 1 review.
  const [scope, setScope] = useState("block");

  const visibleTasks = useMemo(() => allTasks.filter((task) => !task.releasedLocally), [allTasks]);
  const tasks = useMemo(
    () => (scope === "block" ? filterTasksToBlock(visibleTasks, lectures) : visibleTasks),
    [visibleTasks, lectures, scope]
  );

  const groups = useMemo(() => groupStruggleTasks(tasks, { showDone }), [tasks, showDone]);

  const onToggleDone = (id, done) => setStruggleTaskDone(userId, id, done);
  const onRelease = (id) => releaseStruggleTask(userId, id);

  const total = tasks.length;
  const done = tasks.filter((t) => t.doneLocally).length;

  return (
    <div className="p-5">
      <button onClick={onBack} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">
        ← back
      </button>
      <h2 className="text-sm font-bold text-text-1">Struggle Tracker tasks</h2>
      <div className="mb-3 font-mono text-[12px] text-text-3">
        {total} synced from Anki · {done} done today
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {[
          { key: "block", label: "this block" },
          { key: "everything", label: "everything" },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => setScope(s.key)}
            className={
              "rounded border px-2 py-0.5 font-mono text-[12px] " +
              (scope === s.key ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")
            }
          >
            {s.label}
          </button>
        ))}
        <button
          onClick={() => setShowDone((v) => !v)}
          className={
            "rounded border px-2 py-0.5 font-mono text-[12px] " +
            (showDone ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")
          }
        >
          {showDone ? "hide done" : "show done"}
        </button>
      </div>

      {loading ? (
        <div className="font-mono text-[12px] text-text-3">Loading…</div>
      ) : visibleTasks.length === 0 ? (
        <div className="font-mono text-[12px] text-text-3">
          Nothing synced yet. In Anki: Tools → Struggle Tracker → 📤 Export to RxTrack Now — syncs
          automatically within ~30s.
        </div>
      ) : total === 0 ? (
        <div className="font-mono text-[12px] text-text-3">
          Nothing struggling in this block — {visibleTasks.length} synced task{visibleTasks.length === 1 ? "" : "s"} live
          elsewhere. Check "everything" for the full list.
        </div>
      ) : (
        groups.map(([subject, rawCount, rows]) => (
          <div key={subject} className="mb-4">
            <div className="mb-1 font-condensed text-xs font-semibold uppercase tracking-wide text-text-2">
              {subject}{" "}
              <span className="text-text-3">
                ({rows.length}
                {rows.length !== rawCount ? ` · ${rawCount} cards` : ""})
              </span>
            </div>
            {rows.map((r) =>
              r.kind === "group" ? (
                <OcclusionGroupRow key={r.tasks[0].id} tasks={r.tasks} onToggleDone={onToggleDone} onRelease={onRelease} />
              ) : (
                <TaskRow key={r.task.id} task={r.task} onToggleDone={onToggleDone} onRelease={onRelease} />
              )
            )}
          </div>
        ))
      )}
    </div>
  );
}
