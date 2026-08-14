import { useState } from "react";

function hasUserApiKey() {
  try { return !!JSON.parse(localStorage.getItem("rxt-user-api-key") || "null")?.key; }
  catch { return false; }
}

const DIFFICULTIES = ["easy", "medium", "hard"];

/**
 * Shown before a quiz launch — lets the user pick how many questions,
 * difficulty, and whether to draw from the stored pool or regenerate.
 *
 * Props:
 *   storedCount   number  — how many questions already saved for this lecture
 *   defaultCount  number  — pre-fill (e.g. last used or 10)
 *   onStart({ count, difficulty, useStored }) => void
 *   onCancel () => void
 */
export function QuizConfigModal({ storedCount = 0, defaultCount = 10, onStart, onCancel }) {
  const [count, setCount] = useState(String(defaultCount));
  const [difficulty, setDifficulty] = useState("medium");
  const [useStored, setUseStored] = useState(storedCount > 0);
  const userKeyActive = hasUserApiKey();

  const parsed = Math.max(1, Math.min(100, parseInt(count, 10) || 10));
  const needsGeneration = !useStored || storedCount < parsed;
  const willGenerate = needsGeneration;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quiz settings"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-14"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-text-1">Quiz settings</h2>
          <button onClick={onCancel} className="font-mono text-xs text-text-3 hover:text-text-1">✕</button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Question count */}
          <div>
            <label className="mb-1 block font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">
              Questions
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="100"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="w-20 rounded border border-border bg-bg-elevated px-2 py-1 font-mono text-sm text-text-1 focus:border-border-strong focus:outline-none"
              />
              <span className="font-mono text-[12px] text-text-3">max 100</span>
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <div className="mb-1 font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">Difficulty</div>
            <div className="flex gap-1.5">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  onClick={() => setDifficulty(d)}
                  className={[
                    "rounded border px-2.5 py-1 font-mono text-[13px] capitalize transition-colors",
                    difficulty === d
                      ? "border-accent bg-panel text-text-1"
                      : "border-border text-text-3 hover:border-border-strong hover:text-text-2",
                  ].join(" ")}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Stored pool */}
          {storedCount > 0 && (
            <div className="rounded-lg border border-border bg-bg-elevated px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-[13px] text-text-1">
                    {storedCount} question{storedCount !== 1 ? "s" : ""} saved
                  </div>
                  <div className="font-mono text-[12px] text-text-3">
                    {storedCount >= parsed
                      ? "Enough to serve without regenerating"
                      : `${parsed - storedCount} more will be generated`}
                  </div>
                </div>
                <button
                  onClick={() => setUseStored((v) => !v)}
                  className={[
                    "rounded border px-2 py-1 font-mono text-[12px] transition-colors",
                    useStored
                      ? "border-accent text-accent"
                      : "border-border text-text-3 hover:border-border-strong",
                  ].join(" ")}
                >
                  {useStored ? "using saved" : "regenerate"}
                </button>
              </div>
            </div>
          )}

          {willGenerate && (
            <div className="font-mono text-[12px] text-text-3">
              AI will generate{storedCount > 0 && useStored ? ` ${parsed - storedCount} more` : ` ${parsed}`} question{parsed !== 1 ? "s" : ""}. Questions are saved to your bank automatically.
            </div>
          )}
          {storedCount === 0 && (
            <div className="font-mono text-[12px] text-text-3">
              {userKeyActive
                ? "No saved questions yet — AI will generate and save them for next time."
                : <>No saved questions yet. AI will generate via shared server.{" "}
                    <span className="text-text-2">Add your own key (⋯ → AI settings) for faster, dedicated access.</span>
                  </>
              }
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded border border-border px-3 py-1.5 font-mono text-xs text-text-2 hover:text-text-1"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart({ count: parsed, difficulty, useStored })}
            className="rounded bg-accent px-3 py-1.5 font-mono text-xs font-bold text-bg hover:opacity-90"
          >
            Start quiz
          </button>
        </div>
      </div>
    </div>
  );
}
