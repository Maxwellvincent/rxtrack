import { useState } from "react";
import { relinkAllQuestionBanks } from "../../logic/relinkQuestionBanks.js";

/**
 * Re-link every saved homework, IMCQ and ESoft bank to its lectures: finds
 * each bank's home block and week, runs the two-pass objective check there,
 * then links remaining questions by week. Runs in this tab; completed links
 * are saved as it goes.
 */
export function RelinkQuestionBanks({ userId }) {
  const [state, setState] = useState({ running: false, progress: null, results: null, error: null });
  const run = async () => {
    if (state.running) return;
    if (!window.confirm("Re-link every question bank to its lectures? This uses the AI mapping route (Ollama Cloud via the local bridge) for questions that are not yet verified, and can take a while. Keep this tab open; completed links are saved as it goes.")) return;
    setState({ running: true, progress: null, results: null, error: null });
    try {
      const results = await relinkAllQuestionBanks({ userId, onProgress: progress => setState(current => ({ ...current, progress })) });
      setState({ running: false, progress: null, results, error: null });
    } catch (error) {
      setState({ running: false, progress: null, results: null, error: error.message || "Re-linking stopped." });
    }
  };
  const { progress, results } = state;
  const lectureLinked = results?.reduce((sum, row) => sum + (row.lectureLinked || 0), 0) || 0;
  const verified = results?.reduce((sum, row) => sum + (row.linked || 0), 0) || 0;
  const paused = results?.filter(row => row.status === "paused") || [];
  return (
    <div className="mb-3 rounded-lg border border-border bg-panel p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-text-1">Link banks to lectures</div>
          <div className="text-xs text-text-3">Finds each bank's block and week (also for banks filed under CBSE Prep), then links its questions there.</div>
        </div>
        <button type="button" disabled={state.running} onClick={run} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-text-1 hover:border-accent disabled:opacity-50">
          {state.running ? "Linking…" : "Re-link all banks"}
        </button>
      </div>
      {state.running && progress && <p role="status" className="mt-2 text-xs text-text-2">
        Bank {Math.min(progress.total, (progress.index ?? 0) + 1)}/{progress.total} · {progress.filename || ""}{progress.phase === "mapping" ? ` · ${progress.evaluated}/${progress.of} checked` : progress.phase === "scope" ? " · finding its lectures" : ""}
      </p>}
      {results && <p role="status" className="mt-2 text-xs text-text-2">
        ✓ Done · {results.length} banks · {lectureLinked} questions linked to a lecture · {verified} with verified objectives{paused.length ? ` · ⚠ ${paused.length} paused (${paused[0].error || "see bank"})` : ""}
      </p>}
      {state.error && <p role="alert" className="mt-2 text-xs text-bad">{state.error}</p>}
    </div>
  );
}
