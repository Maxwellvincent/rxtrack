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
import { setStruggleTaskDone } from "../../../supabase.js";

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

const STATE_RANK = { persistent: 3, deep: 2, watch: 1, "": 0 };

function TaskRow({ task, onToggleDone }) {
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
    </div>
  );
}

export function StruggleTasks({ userId, onBack }) {
  const { tasks, loading } = useStruggleTasks(userId);
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo(() => {
    const visible = tasks.filter((t) => showDone || !t.doneLocally);
    visible.sort((a, b) => (STATE_RANK[b.state] || 0) - (STATE_RANK[a.state] || 0));
    const byGroup = new Map();
    for (const t of visible) {
      const key = t.subject || "Unclassified";
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(t);
    }
    return [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [tasks, showDone]);

  const onToggleDone = (id, done) => setStruggleTaskDone(userId, id, done);

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

      <button
        onClick={() => setShowDone((v) => !v)}
        className={
          "mb-3 rounded border px-2 py-0.5 font-mono text-[12px] " +
          (showDone ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")
        }
      >
        {showDone ? "hide done" : "show done"}
      </button>

      {loading ? (
        <div className="font-mono text-[12px] text-text-3">Loading…</div>
      ) : total === 0 ? (
        <div className="font-mono text-[12px] text-text-3">
          Nothing synced yet. In Anki: Tools → Struggle Tracker → 📤 Export to RxTrack Now, then run{" "}
          <code>npm run sync:struggle</code> in the rxtrack repo.
        </div>
      ) : (
        groups.map(([subject, items]) => (
          <div key={subject} className="mb-4">
            <div className="mb-1 font-condensed text-xs font-semibold uppercase tracking-wide text-text-2">
              {subject} <span className="text-text-3">({items.length})</span>
            </div>
            {items.map((t) => (
              <TaskRow key={t.id} task={t} onToggleDone={onToggleDone} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
