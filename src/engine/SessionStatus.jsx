/**
 * What a session shows while it has no questions yet.
 *
 * Both session surfaces used one flat line — "build the recognition bank first" —
 * which named a thing the app gave you no way to do, on a block with 24 lectures
 * and hundreds of objectives loaded. Building now happens automatically from the
 * objectives, so the wait needs narrating, and the genuinely-empty case needs to
 * say what is actually missing.
 */
import { Button } from "../ui/Button.jsx";

/** The provider's own words are more useful than anything paraphrased. */
function messageOf(error) {
  const raw = error?.message || String(error || "");
  const depleted = /prepayment credits are depleted|RESOURCE_EXHAUSTED|quota/i.test(raw);
  return depleted
    ? "The question generator ran out of API credit, so no questions came back."
    : raw.slice(0, 300);
}

export function BuildStatus({ build, blockName }) {
  if (!build) return <>Loading your session…</>;

  if (build.phase === "seeding") {
    return (
      <>
        <div className="text-text-1">Preparing {blockName}…</div>
        <div className="mt-2 font-mono text-[11px] text-text-3">
          collecting this block&apos;s objectives as source facts
        </div>
      </>
    );
  }

  return (
    <>
      <div className="text-text-1">Writing your first questions…</div>
      <div className="mt-2 font-mono text-[11px] text-text-3">
        {build.generated
          ? `${build.generated} written from ${build.pooled} objectives`
          : `${build.pooled} objectives queued`}
      </div>
      <div className="mt-1 font-mono text-[10px] text-text-3">
        one-off for this block — a minute or two. Later sessions start instantly.
      </div>
    </>
  );
}

export function NothingToStudy({ blockName, build = null, onExit }) {
  const failed = build?.phase === "failed";

  return (
    <>
      <div className="text-text-1">
        {failed ? `Could not build questions for ${blockName}.` : `Nothing to study in ${blockName} yet.`}
      </div>
      <div className="mt-2 max-w-md font-mono text-[11px] text-text-3">
        {failed ? (
          <>
            {messageOf(build.error)}
            <div className="mt-2 text-text-3">
              {build.pooled} objectives are queued and waiting — nothing was lost, and this will
              work as soon as generation does. Meanwhile Today → Quiz, ◇ Objectives and 🚀 Deep
              Learn use a different generator and still work.
            </div>
          </>
        ) : (
          <>
            This builds its questions from the block&apos;s learning objectives, and this block has
            none yet. Import the lectures (⇉ Folder) — objectives are extracted as part of that —
            then come back.
          </>
        )}
      </div>
      <div className="mt-3"><Button variant="outline" onClick={onExit}>Back</Button></div>
    </>
  );
}
