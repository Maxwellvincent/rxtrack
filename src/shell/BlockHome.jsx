import { useMemo } from "react";
import { readTerms, readLectures, flattenBlocks, blockCoverage } from "./data.js";
import { Button } from "../ui/Button.jsx";
import { StatusGlyph } from "../ui/Badge.jsx";

export function BlockHome({ blockId, onContinue }) {
  const block = useMemo(() => {
    const blocks = flattenBlocks(readTerms(), readLectures());
    return blocks.find((b) => b.id === blockId) || null;
  }, [blockId]);

  if (!block) {
    return <div className="p-6 text-text-3">Select a block to begin.</div>;
  }
  const cov = blockCoverage(block.id);

  return (
    <div className="p-5">
      <h1 className="text-xl font-bold text-text-1">{block.name}</h1>
      <div className="mt-1 font-mono text-[11px] text-text-3">
        {block.lectureCount} lectures{cov != null ? ` · ${cov}% covered` : ""}
      </div>

      <div className="my-4">
        <Button onClick={onContinue}>▸ Continue learning</Button>
        <div className="mt-1.5 font-mono text-[10px] text-text-3">
          adaptive session — teaches, shows a case, then checks you
        </div>
      </div>

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
