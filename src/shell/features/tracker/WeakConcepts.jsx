/**
 * SP1 T4.4 — the weak-concept list.
 *
 * 759 records were sitting in the store with nothing in the shell reading them.
 * Landmines (missed twice or more, never yet held down) come first, because
 * those are the sure-but-wrong gaps the calibration work exists to catch.
 */
import { useMemo, useState } from "react";
import { useWeakConcepts } from "../../hooks/useWeakConcepts.js";
import { weakConceptView, isLandmine, groupWeakConcepts } from "./weakConcepts.js";

const MASTERY_STYLE = {
  struggling: "text-bad",
  developing: "text-text-2",
  mastered: "text-good",
};

function TopicRow({ topic }) {
  const landmine = topic.items.some(isLandmine);
  const count = topic.items.length;

  return (
    <div className="border-b border-border py-1.5 pl-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-text-1">
          {landmine && <span title="missed repeatedly, never yet correct">⚠ </span>}
          {topic.concept}
          {count > 1 && <span className="ml-1 font-mono text-[12px] text-text-3">×{count}</span>}
        </span>
        <span className={"font-mono text-[12px] " + (MASTERY_STYLE[topic.masteryLevel] || "text-text-3")}>
          {topic.masteryLevel || "unknown"}
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[12px] text-text-3">
        {topic.missCount} miss{topic.missCount === 1 ? "" : "es"}
        {count > 1 && ` across ${count} cards`}
      </div>
    </div>
  );
}

function LectureGroup({ lecture }) {
  return (
    <div className="border-b border-border py-2 pl-3 last:border-b-0">
      <div className="mb-1 font-mono text-[12px] font-bold uppercase tracking-wider text-text-3">
        {lecture.lectureLabel}
      </div>
      {lecture.topics.map((topic) => (
        <TopicRow key={topic.concept.toLowerCase()} topic={topic} />
      ))}
    </div>
  );
}

function AngleGroup({ group }) {
  const topicCount = group.lectures.reduce((n, l) => n + l.topics.length, 0);
  return (
    <div className="border-b border-border py-2 last:border-b-0">
      <div className="mb-1 text-sm font-bold capitalize text-text-1">
        {group.angle} ({topicCount})
      </div>
      {group.lectures.map((lecture) => (
        <LectureGroup key={lecture.lectureLabel} lecture={lecture} />
      ))}
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
  const grouped = useMemo(() => groupWeakConcepts(shown), [shown]);

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
          {grouped.map((group) => (
            <AngleGroup key={group.angle} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

export default WeakConcepts;
