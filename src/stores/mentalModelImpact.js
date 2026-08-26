import { readCloud, subscribeToCloudStore, writeCloud } from "./cloudBase.js";
import { readJson, writeJson } from "./base.js";

export const key = "rxt-mental-model-impact-v1";
const fallback = {};
const MAX_ATTEMPTS = 160;
const DAY_MS = 86400000;

export function read(userId) {
  return userId ? readCloud(userId, key, fallback) || fallback : readJson(userId, key, fallback) || fallback;
}

function write(userId, value) {
  return userId ? writeCloud(userId, key, value) : writeJson(userId, key, value);
}

export function recordAttempt(userId, lectureId, event = {}) {
  if (!lectureId) return read(userId);
  const all = read(userId);
  const prev = all[lectureId] || { attempts: [] };
  const attempt = {
    at: event.at || Date.now(),
    correct: !!event.correct,
    responseMs: Number.isFinite(event.responseMs) ? Math.max(0, event.responseMs) : null,
    difficulty: event.difficulty || null,
    taskType: event.taskType || null,
    stem: String(event.stem || "").trim().slice(0, 180),
  };
  const next = { ...prev, attempts: [...(prev.attempts || []), attempt].slice(-MAX_ATTEMPTS) };
  write(userId, { ...all, [lectureId]: next });
  return next;
}

export function markReviewed(userId, lectureId, baseline = {}, now = Date.now()) {
  if (!lectureId) return null;
  const all = read(userId);
  const prev = all[lectureId] || { attempts: [] };
  const next = {
    ...prev,
    reviewedAt: prev.reviewedAt || now,
    lastReviewedAt: now,
    reviewCount: (prev.reviewCount || 0) + 1,
    baseline: prev.baseline || {
      answered: Number(baseline.answered) || 0,
      correct: Number(baseline.correct) || 0,
      capturedAt: now,
    },
  };
  write(userId, { ...all, [lectureId]: next });
  return next;
}

function metrics(attempts) {
  const list = attempts || [];
  const timed = list.filter((a) => Number.isFinite(a.responseMs));
  const sorted = timed.map((a) => a.responseMs).sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = !sorted.length ? null : sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    count: list.length,
    correct: list.filter((a) => a.correct).length,
    accuracy: list.length ? list.filter((a) => a.correct).length / list.length : null,
    medianMs,
  };
}

export function impactFor(entry, now = Date.now()) {
  if (!entry?.reviewedAt) return { state: "not-started", baseline: metrics(entry?.attempts || []), post: metrics([]) };
  const beforeEvents = (entry.attempts || []).filter((a) => a.at <= entry.reviewedAt);
  const baselineSnapshot = entry.baseline || {};
  const granularBaseline = metrics(beforeEvents);
  const baseline = baselineSnapshot.answered
    ? {
        count: baselineSnapshot.answered,
        correct: baselineSnapshot.correct || 0,
        accuracy: (baselineSnapshot.correct || 0) / baselineSnapshot.answered,
        medianMs: granularBaseline.medianMs,
      }
    : granularBaseline;
  const priorStems = new Set(beforeEvents.map((a) => a.stem).filter(Boolean));
  const seenPost = new Set();
  const postEvents = (entry.attempts || []).filter((a) => {
    if (a.at <= entry.reviewedAt) return false;
    if (!a.stem) return true;
    if (priorStems.has(a.stem) || seenPost.has(a.stem)) return false;
    seenPost.add(a.stem);
    return true;
  });
  const post = metrics(postEvents);
  const transfer = metrics(postEvents.filter((a) => ["hard", "expert"].includes(String(a.difficulty).toLowerCase())));
  const delayed24h = metrics(postEvents.filter((a) => a.at - entry.reviewedAt >= DAY_MS));
  const retained7d = metrics(postEvents.filter((a) => a.at - entry.reviewedAt >= 7 * DAY_MS));
  const accuracyDelta = baseline.accuracy != null && post.accuracy != null ? post.accuracy - baseline.accuracy : null;
  const speedDelta = baseline.medianMs != null && post.medianMs != null ? post.medianMs - baseline.medianMs : null;

  let state = "collecting";
  if (post.count >= 10 && baseline.count >= 5) {
    if (accuracyDelta >= 0.1 && (speedDelta == null || speedDelta <= 0)) state = "working";
    else if (accuracyDelta >= 0.05) state = "partial";
    else if (accuracyDelta <= 0 && (speedDelta == null || speedDelta >= 0)) state = "not-working";
    else state = "mixed";
  }
  return { state, baseline, post, transfer, delayed24h, retained7d, accuracyDelta, speedDelta, reviewedAt: entry.reviewedAt, now };
}

export function subscribe(cb) {
  return subscribeToCloudStore(key, cb);
}
