/**
 * Deep Learn's confidence buckets.
 *
 * This file used to hold a second calibration log — `rxt-calibration-log`, a flat array of
 * percent-confidence entries with its own stats and headline helpers. It was write-only: Deep
 * Learn appended to it and nothing ever read it back, so none of those answers reached the
 * accuracy curve or the landmine list, which are built from `rxt-calibration` instead.
 *
 * Deep Learn now records into that one store (see `submitMCQ`, via `engine/calibrationStore.js`),
 * converting its percentage to the 1-5 scale with `confidenceFromPercent`. The buckets stay here
 * because they are still what the UI offers.
 *
 * The old log is left where it is, in localStorage and in the cloud KV under
 * `stores/calibration.js`. Nothing writes or reads it now. It is historical data rather than
 * junk, and deleting a record of answered questions to tidy up a module is not a trade worth
 * making — but do not build anything new on it.
 */
export const CALIBRATION_BUCKETS = [50, 70, 90];

/**
 * Reads rxt-calibration-log and returns per-bucket accuracy stats.
 * Each entry in the log is expected to be { confidence: 50|70|90, correct: boolean, date?: string }.
 * Returns { [bucket]: { n, accuracy, gap } } — gap = accuracy - bucket (negative = overconfident).
 */
export function getCalibrationStats({ sinceISO } = {}) {
  try {
    const raw = localStorage.getItem("rxt-calibration-log");
    if (!raw) return {};
    const log = JSON.parse(raw);
    if (!Array.isArray(log)) return {};
    const filtered = sinceISO ? log.filter((e) => e?.date && e.date >= sinceISO) : log;
    const buckets = {};
    for (const entry of filtered) {
      const conf = entry?.confidence;
      if (!CALIBRATION_BUCKETS.includes(conf)) continue;
      if (!buckets[conf]) buckets[conf] = { n: 0, correct: 0 };
      buckets[conf].n++;
      if (entry.correct) buckets[conf].correct++;
    }
    const stats = {};
    for (const [b, { n, correct }] of Object.entries(buckets)) {
      const accuracy = n > 0 ? Math.round((correct / n) * 100) : null;
      stats[Number(b)] = { n, accuracy, gap: accuracy != null ? accuracy - Number(b) : null };
    }
    return stats;
  } catch {
    return {};
  }
}
