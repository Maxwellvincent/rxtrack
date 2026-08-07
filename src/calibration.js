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
