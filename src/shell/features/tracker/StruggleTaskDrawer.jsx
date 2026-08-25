import { useMemo, useState } from "react";
import { releaseStruggleTask, setStruggleTaskDone } from "../../../supabase.js";
import { useStruggleTasks } from "../../hooks/useStruggleTasks.js";
import { clusterTasks, STATE_RANK } from "./struggleTasks.js";

const STATE_ICON = { persistent: "🔴", deep: "🟠", watch: "🟡" };
const LAUNCHER_HIDDEN_KEY = "rxt-struggle-launcher-hidden";

/** Always-available compact task queue fed by the Struggle Tracker Anki add-on. */
export function StruggleTaskDrawer({ userId }) {
  const [open, setOpen] = useState(false);
  const [launcherHidden, setLauncherHidden] = useState(() => {
    try { return sessionStorage.getItem(LAUNCHER_HIDDEN_KEY) === "1"; } catch { return false; }
  });
  const { tasks, loading } = useStruggleTasks(userId);
  const visible = useMemo(
    () => tasks
      .filter((task) => !task.releasedLocally)
      .sort((a, b) => Number(!!a.doneLocally) - Number(!!b.doneLocally) || (STATE_RANK[b.state] || 0) - (STATE_RANK[a.state] || 0)),
    [tasks]
  );
  const rows = useMemo(() => clusterTasks(visible), [visible]);
  const remaining = rows.filter((row) => {
    const grouped = row.kind === "group" ? row.tasks : [row.task];
    return !grouped.every((task) => task.doneLocally);
  }).length;

  return (
    <>
      {!launcherHidden && (
        <div className="fixed bottom-5 right-5 z-40 flex items-center rounded-full border border-accent/40 bg-bg-elevated shadow-lg hover:border-accent">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex min-h-11 items-center gap-2 rounded-l-full px-4 py-2 text-sm font-semibold text-text-1"
            aria-label={`Open Struggle Tracker, ${remaining} tasks remaining`}
          >
            <span aria-hidden="true">🔴</span>
            <span>Struggle</span>
            <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[12px] text-bg">{remaining}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.setItem(LAUNCHER_HIDDEN_KEY, "1"); } catch { /* optional preference */ }
              setLauncherHidden(true);
            }}
            className="mr-1 flex min-h-9 min-w-8 items-center justify-center rounded-full text-sm text-text-3 hover:bg-panel hover:text-text-1"
            aria-label="Hide Struggle Tracker button for this session"
            title="Hide until your next browser session"
          >
            ×
          </button>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/25" onMouseDown={() => setOpen(false)} role="presentation">
          <aside
            className="ml-auto flex h-full w-[min(92vw,420px)] flex-col border-l border-border bg-bg-elevated shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
            aria-label="Struggle Tracker task drawer"
          >
            <header className="flex items-start justify-between border-b border-border p-5">
              <div>
                <h2 className="text-base font-bold text-text-1">Struggle Tracker</h2>
                <p className="mt-1 text-sm text-text-3">{remaining} to tackle · synced with Focus HUD</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="min-h-10 min-w-10 rounded border border-border text-lg text-text-2 hover:text-text-1" aria-label="Close Struggle Tracker">×</button>
            </header>
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <p className="text-sm text-text-3">Syncing tasks…</p>
              ) : rows.length === 0 ? (
                <div className="rounded-lg border border-border bg-panel p-4 text-sm text-text-3">
                  You’re clear. New deep-review and Study Hold cards appear after the Anki add-on exports.
                </div>
              ) : rows.map((row) => {
                const grouped = row.kind === "group" ? row.tasks : [row.task];
                const task = grouped[0];
                const allDone = grouped.every((item) => item.doneLocally);
                const state = grouped.reduce(
                  (best, item) => (STATE_RANK[item.state] > STATE_RANK[best] ? item.state : best),
                  task.state || ""
                );
                return (
                <article key={grouped.map((item) => item.id).join("|")} className="mb-2 rounded-lg border border-border bg-panel p-3">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={allDone}
                      onChange={(event) => grouped.forEach((item) => setStruggleTaskDone(userId, item.id, event.target.checked))}
                      className="mt-1 h-4 w-4 shrink-0 accent-accent"
                    />
                    <span className={`min-w-0 flex-1 text-sm leading-5 text-text-1 ${allDone ? "line-through opacity-50" : ""}`}>
                      {STATE_ICON[state] || ""} {task.concept || task.front || "Unclassified card"}
                      {grouped.length > 1 && (
                        <span className="ml-2 whitespace-nowrap rounded-full border border-border px-1.5 py-0.5 font-mono text-[11px] text-text-3">
                          🖼 {grouped.length} occlusions · one task
                        </span>
                      )}
                    </span>
                  </label>
                  {(task.lecture || task.subject) && <p className="ml-7 mt-1 text-[12px] text-text-3">{[task.subject, task.lecture].filter(Boolean).join(" · ")}</p>}
                  {allDone && (
                    <div className="ml-7 mt-2 flex items-center justify-between gap-3">
                      <span className="text-[12px] text-text-3">Checked in RXtrack + Focus HUD{grouped.length > 1 ? ` · ${grouped.length} cards` : ""}</span>
                      <button type="button" onClick={() => grouped.forEach((item) => releaseStruggleTask(userId, item.id))} className="rounded border border-accent/40 px-2.5 py-1 text-[12px] font-semibold text-text-1 hover:border-accent">Release {grouped.length > 1 ? "group" : "card"}</button>
                    </div>
                  )}
                </article>
              );})}
            </div>
            <footer className="border-t border-border px-5 py-3 text-[12px] leading-5 text-text-3">
              Release removes a checked task from both lists. Anki scheduling only changes inside the add-on.
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
