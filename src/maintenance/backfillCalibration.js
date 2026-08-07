/**
 * One-shot backfill of the old Deep Learn calibration log into the live record, runnable from
 * the browser console:
 *
 *   const m = await import("/src/maintenance/backfillCalibration.js");
 *   await m.runCalibrationBackfill({ userId, dryRun: true });
 *   await m.runCalibrationBackfill({ userId });
 *
 * `rxt-calibration-log` was write-only — Deep Learn appended to it and nothing ever read it back
 * (see src/calibration.js). Those answers were real, so they belong in the accuracy curve; the
 * leak is fixed at the source now, and this carries the history across.
 *
 * Safe to run twice. Timestamps come from each entry's own recorded date and concepts are
 * derived deterministically, so `mergeCalibration` — which dedupes on `ts|concept` — collapses a
 * second run onto the first. Nothing is deleted: the old log stays exactly where it is.
 */
import { confidenceFromPercent, CONFIDENT_THRESHOLD } from "../engine/calibration.js";
import * as legacyStore from "../stores/calibration.js";
import * as calibrationStore from "../stores/calibrationByBlock.js";
import * as objectivesStore from "../stores/blockObjectives.js";

/** Entries with no block still happened; they land here rather than being dropped. */
const NO_BLOCK = "deeplearn";

/**
 * Turn the legacy log into records the live store understands.
 *
 * The old rows carry an objectiveId but no concept text, and the landmine list shows concepts to
 * a human. So the objective's own wording is used when it can be resolved, and when it cannot the
 * label says plainly that this came from Deep Learn instead of inventing a topic for it.
 *
 * @param {Array} log      raw `rxt-calibration-log` entries
 * @param {{resolveConcept?: (objectiveId: string) => string|null}} deps
 */
export function planCalibrationBackfill(log, { resolveConcept } = {}) {
  const byBlock = {};
  let skipped = 0;

  for (const e of log || []) {
    const ts = Date.parse(e?.date);
    // Without a usable timestamp there is no stable identity, so a second run would duplicate it.
    if (!Number.isFinite(ts) || !Number.isFinite(e?.predicted)) {
      skipped += 1;
      continue;
    }
    const blockId = e.blockId || NO_BLOCK;
    const resolved = e.objectiveId && resolveConcept ? resolveConcept(e.objectiveId) : null;
    const concept = resolved || `Deep Learn · ${e.lectureId || "unlabelled"}`;
    (byBlock[blockId] ||= []).push({
      ts,
      concept,
      confidence: confidenceFromPercent(e.predicted),
      correct: !!e.correct,
      source: "deeplearn-backfill",
    });
    }

  const total = Object.values(byBlock).reduce((n, list) => n + list.length, 0);
  const landmines = Object.values(byBlock)
    .flat()
    .filter((r) => r.confidence >= CONFIDENT_THRESHOLD && !r.correct).length;

  return { byBlock, total, skipped, blocks: Object.keys(byBlock).length, landmines };
}

/** Read the old log, plan the conversion, and (unless dryRun) merge it into the live record. */
export async function runCalibrationBackfill({ userId, dryRun = false } = {}) {
  const log = legacyStore.read(userId) || [];
  const objectives = objectivesStore.read(userId) || {};
  const byId = new Map();
  for (const list of Object.values(objectives)) {
    for (const o of Array.isArray(list) ? list : []) {
      if (o?.id) byId.set(o.id, o.objective || o.text || null);
    }
  }

  const plan = planCalibrationBackfill(log, { resolveConcept: (id) => byId.get(id) || null });
  console.log(
    `[backfill] ${log.length} legacy entries → ${plan.total} records across ${plan.blocks} block(s)` +
      `, ${plan.skipped} skipped, ${plan.landmines} landmine(s)${dryRun ? " (dry run)" : ""}`
  );
  if (dryRun || !plan.total) return plan;

  for (const [blockId, records] of Object.entries(plan.byBlock)) {
    for (const r of records) calibrationStore.appendRecord(userId, blockId, r);
  }
  console.log(`[backfill] done — the old log is untouched at ${legacyStore.key}`);
  return plan;
}
