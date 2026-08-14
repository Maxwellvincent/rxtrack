import { blockCoverage } from "./data.js";
import { useBlocks } from "./hooks/useBlocks.js";
import { useObjectives } from "./hooks/useObjectives.js";
import { Button } from "../ui/Button.jsx";
import { StatusGlyph } from "../ui/Badge.jsx";
export function BlockHome({ blockId, userId = null, onContinue, onCalibrate, onObjectives, onLectures, onWeakConcepts, onDeepLearn, today = null, statsOnly = false }) {
  // Via the stores, not a one-shot localStorage read: the terms arrive from
  // Firestore after the first paint, so a memo over localStorage resolved to no
  // block and never re-ran — the pane sat on "Select a block" while the sidebar,
  // which is store-backed, showed the block highlighted.
  const blocks = useBlocks(userId);
  const objectives = useObjectives(null, userId);
  const block = blocks.find((b) => b.id === blockId) || null;

  if (!block) {
    return <div className="p-6 text-text-3">Select a block to begin.</div>;
  }
  const cov = blockCoverage(objectives.data, block.id);

  return (
    <div className={statsOnly ? "px-5 pb-4" : "p-5"}>
      {!statsOnly && (
        <>
          <h1 className="font-condensed text-xl font-bold uppercase tracking-wide text-text-1">{block.name}</h1>
          <div className="mt-1 font-mono text-[11px] text-text-3">
            {block.lectureCount} lectures{cov != null ? ` · ${cov}% covered` : ""}
          </div>
          {today && <div className="my-4 border-y border-border py-4">{today}</div>}
          <div className="my-4 flex flex-col gap-3">
            <div>
              <Button onClick={onContinue}>▸ Continue learning</Button>
              <div className="mt-1.5 font-mono text-[10px] text-text-3">
                adaptive session — teaches, shows a case, then checks you
              </div>
            </div>
            {onCalibrate && (
              <div>
                <Button variant="outline" onClick={onCalibrate}>◎ Calibrate</Button>
                <div className="mt-1.5 font-mono text-[10px] text-text-3">
                  rate your confidence before each answer — surfaces sure-but-wrong gaps
                </div>
              </div>
            )}
            {onObjectives && (
              <div>
                <Button variant="outline" onClick={onObjectives}>◇ Objectives</Button>
                <div className="mt-1.5 font-mono text-[10px] text-text-3">
                  per-lecture coverage, linking, and objective-targeted quizzes
                </div>
              </div>
            )}
            {onLectures && (
              <div>
                <Button variant="outline" onClick={onLectures}>▤ Lectures</Button>
                <div className="mt-1.5 font-mono text-[10px] text-text-3">
                  every lecture in the block — filter, search, quick-log a session
                </div>
              </div>
            )}
            {onWeakConcepts && (
              <div>
                <Button variant="outline" onClick={onWeakConcepts}>⚠ Weak concepts</Button>
                <div className="mt-1.5 font-mono text-[10px] text-text-3">
                  what you keep missing, landmines first
                </div>
              </div>
            )}
            {onDeepLearn && (
              <div>
                <Button variant="outline" onClick={onDeepLearn}>🧬 Deep Learn</Button>
                <div className="mt-1.5 font-mono text-[10px] text-text-3">
                  teach-then-test on one lecture, with drills and rapid fire
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-2">
        {cov == null && <div className="text-xs text-text-3">No coverage data yet for this block.</div>}
        {cov != null && (
          <div className="flex items-center justify-between border-t border-border py-2 text-xs text-text-2">
            <span className="flex items-center gap-2"><StatusGlyph status={block.status} /> Objectives coverage</span>
            <span className="flex items-center gap-2">
              <span className="block h-1.5 w-28 overflow-hidden rounded bg-border">
                <span className="block h-full bg-accent" style={{ width: `${cov}%` }} />
              </span>
              <b className="text-accent-text">{cov}%</b>
            </span>
          </div>
        )}
      </div>

    </div>
  );
}
