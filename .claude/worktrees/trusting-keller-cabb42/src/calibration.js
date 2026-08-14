/**
 * Calibration log — tracks predicted confidence vs. actual correctness per answer.
 * Purpose: surface the "felt confident, scored average" gap.
 *
 * Stored under localStorage key `rxt-calibration-log` as an array of entries.
 * Synced to Supabase via user_kv (see supabase.js KV_KEYS).
 */

import { supabase, scheduleDebouncedCloudPush } from "./supabase";

const STORAGE_KEY = "rxt-calibration-log";
const MAX_ENTRIES = 5000;

export const CALIBRATION_BUCKETS = [50, 70, 90];

function loadLog() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLog(log) {
  try {
    const trimmed = log.length > MAX_ENTRIES ? log.slice(-MAX_ENTRIES) : log;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new CustomEvent("rxt-calibration-updated"));
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id) scheduleDebouncedCloudPush(data.user.id);
    }).catch(() => {});
  } catch (e) {
    console.error("saveCalibrationLog failed:", e);
  }
}

export function recordCalibration({ predicted, correct, source = "", blockId = null, objectiveId = null, lectureId = null }) {
  if (!CALIBRATION_BUCKETS.includes(predicted)) return;
  const log = loadLog();
  log.push({
    date: new Date().toISOString(),
    predicted,
    correct: !!correct,
    source,
    blockId,
    objectiveId,
    lectureId,
  });
  saveLog(log);
}

/**
 * Returns stats per bucket: { 50: {n, accuracy, gap}, 70: {...}, 90: {...} }.
 * `gap` is (accuracy - predicted) — negative = overconfident, positive = underconfident.
 * Pass `filter` to scope by blockId or source.
 */
export function getCalibrationStats(filter = {}) {
  const log = loadLog();
  const filtered = log.filter((e) => {
    if (filter.blockId && e.blockId !== filter.blockId) return false;
    if (filter.source && e.source !== filter.source) return false;
    if (filter.sinceISO && e.date < filter.sinceISO) return false;
    return true;
  });
  const stats = {};
  for (const bucket of CALIBRATION_BUCKETS) {
    const entries = filtered.filter((e) => e.predicted === bucket);
    const n = entries.length;
    const correct = entries.filter((e) => e.correct).length;
    const accuracy = n > 0 ? Math.round((correct / n) * 100) : null;
    const gap = accuracy != null ? accuracy - bucket : null;
    stats[bucket] = { n, accuracy, gap };
  }
  stats.total = filtered.length;
  return stats;
}

/** One-line summary like "Overconfident on 90s (72%, -18)" or "Well calibrated". */
export function getCalibrationHeadline(filter = {}) {
  const stats = getCalibrationStats(filter);
  if (stats.total < 10) return `Not enough data yet (${stats.total}/10 minimum)`;
  const worst = CALIBRATION_BUCKETS
    .map((b) => ({ bucket: b, ...stats[b] }))
    .filter((s) => s.n >= 3 && s.gap != null)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];
  if (!worst || Math.abs(worst.gap) <= 5) return "Well calibrated";
  const label = worst.gap < 0 ? "Overconfident" : "Underconfident";
  return `${label} on ${worst.bucket}% (${worst.accuracy}% actual, ${worst.gap > 0 ? "+" : ""}${worst.gap})`;
}
