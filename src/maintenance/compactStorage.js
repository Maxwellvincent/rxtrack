/**
 * One-shot storage compaction, runnable from the browser console:
 *
 *   const m = await import("/src/maintenance/compactStorage.js");
 *   await m.runCompaction({ userId, dryRun: true });   // report only
 *   await m.runCompaction({ userId, dropBlocks: ["ftm2_default"] });
 *
 * Local compaction alone does not survive a sync — `mergeBlockObjectives` puts
 * every stripped field back from the cloud copy, and a pull restores a deleted
 * block. So a real run rewrites the cloud docs authoritatively too, which is why
 * the destructive half is opt-in and reported.
 */
import * as objectivesStore from "../stores/blockObjectives.js";
import { compactObjectivesStore, findKeeperFor } from "../stores/compact.js";
import { overwriteObjectivesInCloud } from "../supabase.js";

const KB = (bytes) => Math.round(bytes / 1024);

/** Total bytes currently in localStorage, for a believable before/after. */
export function storageBytes() {
  let total = 0;
  for (const key of Object.keys(localStorage)) total += (localStorage.getItem(key) || "").length;
  return total;
}

/**
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string[]} [opts.dropBlocks] block keys to delete locally AND in the cloud
 * @param {boolean} [opts.dryRun] compute and report without writing anything
 */
export async function runCompaction({ userId, dropBlocks = [], dryRun = false } = {}) {
  const store = objectivesStore.read(userId) || {};
  const totalBefore = storageBytes();

  // Guard the destructive half: refuse to drop anything that is not a dead copy
  // of a block that survives.
  const refused = [];
  const safeDrops = [];
  for (const blockId of dropBlocks) {
    const { keeper, exact, candidates } = findKeeperFor(store, blockId);
    if (keeper) safeDrops.push({ blockId, duplicateOf: keeper, exactIdMatch: exact, alsoCoveredBy: candidates });
    else refused.push({ blockId, reason: "carries progress of its own, or no block covers its objectives" });
  }

  const { next, stats } = compactObjectivesStore(store, { dropBlocks: safeDrops.map((d) => d.blockId) });

  const report = {
    dryRun,
    objectivesKB: { before: KB(stats.before), after: KB(stats.after), saved: KB(stats.saved) },
    totalKB: { before: KB(totalBefore), after: null },
    dropped: safeDrops,
    refusedDrops: refused,
    cloud: null,
  };

  if (dryRun) return report;

  objectivesStore.write(userId, next);
  report.totalKB.after = KB(storageBytes());
  report.cloud = await overwriteObjectivesInCloud(userId, next, safeDrops.map((d) => d.blockId));
  return report;
}
