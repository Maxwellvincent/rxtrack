import { useMemo } from "react";
import { blockCoverage } from "./data.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { useObjectives } from "./hooks/useObjectives.js";
import { selectBlockObjectives } from "./logic/objectives.js";

/**
 * Segmented horizontal bar — mastered/learning/struggling fill left-to-right,
 * untested is the remaining background. Icon + text labels elsewhere carry the
 * meaning so color is never the sole signal.
 */
function CoverageBar({ mastered = 0, inprogress = 0, struggling = 0, untested = 0 }) {
  const total = mastered + inprogress + struggling + untested;
  if (!total) return null;
  const w = (n) => `${(n / total * 100).toFixed(1)}%`;
  return (
    <div
      className="flex h-1 w-full overflow-hidden rounded-full bg-border"
      role="img"
      aria-label={`${mastered} mastered, ${inprogress} learning, ${struggling} struggling, ${untested} untested`}
    >
      {mastered > 0 && (
        <div style={{ width: w(mastered), background: "var(--color-good)", flexShrink: 0 }} />
      )}
      {inprogress > 0 && (
        <div style={{ width: w(inprogress), background: "var(--color-accent)", flexShrink: 0 }} />
      )}
      {struggling > 0 && (
        <div style={{ width: w(struggling), background: "var(--color-warn)", flexShrink: 0 }} />
      )}
    </div>
  );
}

const ACTIONS = [
  { key: "continue",   icon: "▸", label: "Continue",     desc: "Adaptive teach → case → check",      hKey: "onContinue" },
  { key: "calibrate",  icon: "◎", label: "Calibrate",    desc: "Find sure-but-wrong gaps",            hKey: "onCalibrate" },
  { key: "objectives", icon: "◇", label: "Objectives",   desc: "Coverage, linking, quiz targets",     hKey: "onObjectives" },
  { key: "lectures",   icon: "▤", label: "Lectures",     desc: "All lectures — filter, search, log",  hKey: "onLectures" },
  { key: "weak",       icon: "⚠", label: "Weak spots",   desc: "What you keep missing",               hKey: "onWeakConcepts" },
  { key: "deep",       icon: "⬡", label: "Deep Learn",   desc: "Teach-then-test one lecture",         hKey: "onDeepLearn" },
];

export function BlockHome({
  blockId,
  userId = null,
  onContinue,
  onCalibrate,
  onObjectives,
  onLectures,
  onWeakConcepts,
  onDeepLearn,
  today = null,
  statsOnly = false,
}) {
  const blocks = useBlocks(userId);
  const objectives = useObjectives(null, userId);
  const block = blocks.find((b) => b.id === blockId) || null;

  const blockObjs = useMemo(
    () => selectBlockObjectives(objectives.data || {}, blockId),
    [objectives.data, blockId]
  );

  const counts = useMemo(() => {
    const mastered   = blockObjs.filter((o) => o.status === "mastered").length;
    const inprogress = blockObjs.filter((o) => o.status === "developing").length;
    const struggling = blockObjs.filter((o) => o.status === "struggling").length;
    const untested   = blockObjs.filter((o) => !o.status || o.status === "untested").length;
    return { mastered, inprogress, struggling, untested, total: blockObjs.length };
  }, [blockObjs]);

  if (!block) return <div className="p-6 text-text-3">Select a block to begin.</div>;

  const cov = blockCoverage(objectives.data, block.id);
  const handlers = { onContinue, onCalibrate, onObjectives, onLectures, onWeakConcepts, onDeepLearn };

  if (statsOnly) {
    return (
      <div className="px-5 pb-4">
        {counts.total > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            <CoverageBar {...counts} />
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[12px]">
              <span className="text-good">✓ {counts.mastered} mastered</span>
              <span className="text-accent">◑ {counts.inprogress} learning</span>
              {counts.struggling > 0 && <span className="text-warn">⚠ {counts.struggling} struggling</span>}
              <span className="text-text-3">○ {counts.untested} untested</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-5">
      {/* ── Block header ──────────────────────────────────── */}
      <div className="mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1">
          <h1 className="font-condensed text-xl font-bold uppercase tracking-wide text-text-1">
            {block.name}
          </h1>
          {block.lectureCount > 0 && (
            <span className="font-mono text-[12px] text-text-3">{block.lectureCount} lectures</span>
          )}
        </div>

        {counts.total > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            <CoverageBar {...counts} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[12px]">
              <span className="text-good">✓ {counts.mastered} mastered</span>
              <span className="text-accent">◑ {counts.inprogress} learning</span>
              {counts.struggling > 0 && <span className="text-warn">⚠ {counts.struggling} struggling</span>}
              <span className="text-text-3">○ {counts.untested} untested</span>
              {cov != null && (
                <span className="ml-auto text-text-3">{cov}% covered</span>
              )}
            </div>
          </div>
        )}

        {counts.total === 0 && cov != null && (
          <div className="mt-1 font-mono text-[12px] text-text-3">{cov}% covered</div>
        )}
      </div>

      {today && <div className="mb-5 border-y border-border py-4">{today}</div>}

      {/* ── Action card grid ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2">
        {ACTIONS.map(({ key, icon, label, desc, hKey }, i) => {
          const h = handlers[hKey];
          if (!h) return null;
          const isPrimary = i === 0;
          return (
            <button
              key={key}
              onClick={h}
              className={[
                "group flex flex-col gap-1 rounded-sm border px-3 py-3 text-left transition-all",
                isPrimary
                  ? "border-accent/60 bg-accent-soft hover:border-accent hover:bg-accent-soft"
                  : "border-border bg-bg-elevated hover:border-border-strong hover:bg-panel",
              ].join(" ")}
              style={{
                boxShadow: isPrimary
                  ? "0 2px 8px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.10)"
                  : "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05)",
              }}
            >
              <span className={[
                "font-condensed text-[12px] font-bold uppercase tracking-wide transition-colors",
                isPrimary ? "text-accent-text" : "text-text-2 group-hover:text-text-1",
              ].join(" ")}>
                {icon} {label}
              </span>
              <span className="font-mono text-[11px] leading-snug text-text-3">{desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
