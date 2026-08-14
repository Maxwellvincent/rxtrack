/**
 * SP1 T4.4 — the weak-concept list.
 *
 * 759 records were sitting in the store with nothing in the shell reading them.
 * Landmines (missed twice or more, never yet held down) come first, because
 * those are the sure-but-wrong gaps the calibration work exists to catch.
 */
import { useMemo, useState } from "react";
import { useWeakConcepts } from "../../hooks/useWeakConcepts.js";
import { weakConceptView, isLandmine } from "./weakConcepts.js";

const MASTERY_STYLE = {
  struggling: "text-bad",
  developing: "text-text-2",
  mastered: "text-good",
};

function ConceptRow({ concept }) {
  const landmine = isLandmine(concept);
  const attempts = concept.totalAttempts || 0;
  const misses = concept.missCount || 0;

  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-text-1">
          {landmine && <span title="missed repeatedly, never yet correct">⚠ </span>}
          {concept.concept || concept.description}
        </span>
        <span className={"font-mono text-[12px] " + (MASTERY_STYLE[concept.masteryLevel] || "text-text-3")}>
          {concept.masteryLevel || "unknown"}
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-text-3">
        {misses} miss{misses === 1 ? "" : "es"}
        {attempts > 0 && ` of ${attempts} attempt${attempts === 1 ? "" : "s"}`}
        {concept.consecutiveCorrect > 0 && ` · ${concept.consecutiveCorrect} correct in a row`}
        {concept.lastMissed && ` · last missed ${String(concept.lastMissed).slice(0, 10)}`}
        {concept.lectureLabels?.[0] && ` · ${String(concept.lectureLabels[0]).slice(0, 46)}`}
      </div>
    </div>
  );
}

export function WeakConcepts({ blockId, userId, onBack }) {
  const store = useWeakConcepts(null, userId);
  const [scope, setScope] = useState("block"); // block | everything
  const [includeMastered, setIncludeMastered] = useState(false);
  const [landminesOnly, setLandminesOnly] = useState(false);

  const view = useMemo(
    () => weakConceptView(store.data, { blockId: scope === "block" ? blockId : null, includeMastered }),
    [store.data, blockId, scope, includeMastered]
  );

  const shown = landminesOnly ? view.landmines : view.concepts;

  return (
    <div className="p-5">
      <button onClick={onBack} className="mb-3 font-mono text-xs text-text-3 hover:text-text-1">← block</button>
      <h2 className="text-sm font-bold text-text-1">Weak concepts</h2>
      <div className="mb-3 font-mono text-[12px] text-text-3">
        {view.counts.total} tracked · {view.counts.struggling || 0} struggling · {view.counts.landmines} landmines
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
          onClick={() => setLandminesOnly((v) => !v)}
          className={
            "rounded border px-2 py-0.5 font-mono text-[12px] " +
            (landminesOnly ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")
          }
        >
          ⚠ landmines only
        </button>
        <button
          onClick={() => setIncludeMastered((v) => !v)}
          className={
            "rounded border px-2 py-0.5 font-mono text-[12px] " +
            (includeMastered ? "border-accent text-text-1" : "border-border text-text-3 hover:text-text-2")
          }
        >
          show mastered
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border border-border p-3 text-xs text-text-3">
          Nothing tracked here yet — weak concepts are recorded when you miss questions.
        </div>
      ) : (
        <div className="rounded-lg border border-border px-3">
          {shown.slice(0, 200).map((concept, i) => (
            <ConceptRow key={concept.id || `${concept.concept}-${i}`} concept={concept} />
          ))}
          {shown.length > 200 && (
            <div className="py-2 font-mono text-[12px] text-text-3">
              showing the worst 200 of {shown.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WeakConcepts;
