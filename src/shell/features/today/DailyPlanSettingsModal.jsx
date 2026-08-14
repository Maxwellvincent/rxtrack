import { useState, useCallback } from "react";

function sleepWakeKey(blockId) { return `rxt-sleepwake-${blockId}-${new Date().toDateString()}`; }
function lecConfigKey(blockId) { return `rxt-lecconfig-${blockId}`; }

function readSleepWake(blockId) {
  try { return JSON.parse(localStorage.getItem(sleepWakeKey(blockId)) || "{}"); }
  catch { return {}; }
}
function readLecConfig(blockId) {
  try {
    const raw = localStorage.getItem(lecConfigKey(blockId));
    if (raw) return JSON.parse(raw);
    const oldTime = localStorage.getItem(`rxt-lectime-${blockId}`);
    return { time: oldTime || null, duration: 50 };
  } catch { return { time: null, duration: 50 }; }
}

export function DailyPlanSettingsModal({ blockId, onClose }) {
  const [wakeTime, setWakeTime] = useState(() => readSleepWake(blockId).wakeTime ?? "");
  const [lecConfig, setLecConfig] = useState(() => readLecConfig(blockId));

  const commit = useCallback(() => {
    localStorage.setItem(sleepWakeKey(blockId), JSON.stringify({ wakeTime: wakeTime || null }));
    localStorage.setItem(lecConfigKey(blockId), JSON.stringify(lecConfig));
    window.dispatchEvent(new CustomEvent("rxt-dayplan-settings-changed", { detail: { blockId } }));
    onClose?.();
  }, [blockId, wakeTime, lecConfig, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Daily plan settings"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-14"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-1">Daily plan settings</h2>
          <button onClick={onClose} className="font-mono text-xs text-text-3 hover:text-text-1">✕</button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">Wake time</div>
            <div className="mb-2 font-mono text-[12px] text-text-3">Today only — drives mode suggestion.</div>
            <input
              type="time"
              value={wakeTime}
              onChange={(e) => setWakeTime(e.target.value)}
              className="rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-xs text-text-1 focus:outline-none focus:border-border-strong"
            />
          </div>

          <div>
            <div className="mb-1 font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">Lecture schedule</div>
            <div className="mb-2 font-mono text-[12px] text-text-3">Block-scoped — set once per term.</div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-text-3">starts at</span>
                <input
                  type="time"
                  value={lecConfig.time ?? ""}
                  onChange={(e) => setLecConfig((c) => ({ ...c, time: e.target.value || null }))}
                  className="rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-xs text-text-1 focus:outline-none focus:border-border-strong"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-text-3">each</span>
                <input
                  type="number"
                  min="10" max="180" step="5"
                  value={lecConfig.duration ?? ""}
                  placeholder="50"
                  onChange={(e) => setLecConfig((c) => ({ ...c, duration: e.target.value === "" ? 50 : parseInt(e.target.value, 10) }))}
                  className="w-14 rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-xs text-text-1 focus:outline-none focus:border-border-strong"
                />
                <span className="font-mono text-[12px] text-text-3">min</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-border px-3 py-1.5 font-mono text-xs text-text-2 hover:text-text-1"
          >
            Cancel
          </button>
          <button
            onClick={commit}
            className="rounded bg-accent px-3 py-1.5 font-mono text-xs font-bold text-bg hover:opacity-90"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
