// ── focus-hud study time ─────────────────────────────────────────────────────
// Reports how long study actually lasted, not merely that it is happening.
//
// The activity signal is a heartbeat: it says what is on screen right now and
// vanishes when the work stops, so focus-hud could offer to start a timer but
// never learned that an hour of question banks had gone by. Everything done
// here was therefore missing from every total that app keeps.
//
// Time is written as deltas inside a transaction — seconds elapsed since the
// last flush, added to whatever the day already holds — so a reload, a second
// tab, or a crash mid-session can neither double-count nor lose the time.
//
// Contract: focus-hud/docs/rxtrack-contract.md

import { doc, runTransaction, Timestamp } from "firebase/firestore";
import { focusHudDb, focusHudUserId, isFocusHudConfigured } from "./focusHudLink.js";

const SOURCE = "rxtrack";

/** How often accumulated time is written. Matches the signal heartbeat. */
export const FLUSH_MS = 30_000;

function newBurstId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** focus-hud's focus day runs 04:00 to 04:00; the day keys must agree. */
const DAY_BOUNDARY_HOUR = 4;

/** `YYYY-MM-DD` for the focus day an instant belongs to, in local time. */
export function focusDayKey(instantMs = Date.now()) {
  const date = new Date(instantMs);
  if (date.getHours() < DAY_BOUNDARY_HOUR) date.setDate(date.getDate() - 1);

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Adds a delta to a day's entries, merging by kind and detail.
 *
 * Pure, so the awkward cases — an unknown day, a repeated lecture, a corrupt
 * entry written by an older build — are provable without Firestore.
 */
export function applyStudyDelta(entries, { kind, detail, studiedMs }) {
  if (!(studiedMs > 0)) return Array.isArray(entries) ? entries : [];

  const existing = Array.isArray(entries) ? entries : [];
  const next = [];
  let merged = false;

  for (const entry of existing) {
    if (!entry || typeof entry.kind !== "string") continue;
    const sameThing = entry.kind === kind && (entry.detail ?? null) === (detail ?? null);

    if (sameThing) {
      merged = true;
      next.push({
        kind,
        detail: detail ?? null,
        studiedMs: Number(entry.studiedMs ?? 0) + studiedMs,
      });
    } else {
      next.push({
        kind: entry.kind,
        detail: entry.detail ?? null,
        studiedMs: Number(entry.studiedMs ?? 0),
      });
    }
  }

  if (!merged) next.push({ kind, detail: detail ?? null, studiedMs });

  // focus-hud's rules cap the array; keep the biggest, which is where the study
  // actually was.
  return next.sort((a, b) => b.studiedMs - a.studiedMs).slice(0, 200);
}

/** focus-hud's rules cap these lists; keep the newest, which is the live sitting. */
const MAX_BURSTS = 200

/**
 * Adds a delta to the day's bursts, keyed by the tracking session that reported
 * it.
 *
 * Durations alone cannot say *when* studying happened, so focus-hud had to lay
 * the day's total end to end from 04:00 — every session appeared to start at
 * the boundary hour, and its hour-of-day chart had to leave RXTrack out
 * entirely rather than show a rhythm that never happened.
 *
 * `startedAt` is derived by walking back from now by the delta, so the first
 * flush of a sitting records when it actually began rather than when it was
 * first written.
 */
export function applyBurstDelta(bursts, { id, kind, detail, studiedMs, nowMs }) {
  if (!(studiedMs > 0)) return Array.isArray(bursts) ? bursts : [];

  const existing = Array.isArray(bursts) ? bursts : [];
  const next = [];
  let merged = false;

  for (const burst of existing) {
    if (!burst || typeof burst.id !== "string") continue;

    if (burst.id === id) {
      merged = true;
      next.push({
        ...burst,
        endedAt: nowMs,
        studiedMs: Number(burst.studiedMs ?? 0) + studiedMs,
      });
    } else {
      next.push(burst);
    }
  }

  if (!merged) {
    next.push({
      id,
      kind,
      detail: detail ?? null,
      startedAt: nowMs - studiedMs,
      endedAt: nowMs,
      studiedMs,
    });
  }

  return next.slice(-MAX_BURSTS);
}

function dayRef(db, userId, dayKey) {
  return doc(db, `users/${userId}/externalStudy/${dayKey}`);
}

/**
 * Adds elapsed study time to a focus day.
 *
 * Fire-and-forget by design: studying must never block or fail because a
 * companion app's bookkeeping did not write.
 */
export async function reportStudyTime(kind, detail, studiedMs, nowMs = Date.now(), burstId = null) {
  if (!isFocusHudConfigured) return false;
  if (!(studiedMs > 0)) return false;

  const userId = focusHudUserId();
  const db = focusHudDb();
  if (!userId || !db) return false;

  const ref = dayRef(db, userId, focusDayKey(nowMs));

  try {
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.exists() ? snapshot.data() : {};

      const entries = applyStudyDelta(data.entries, { kind, detail, studiedMs });
      const bursts = burstId
        ? applyBurstDelta(data.bursts, { id: burstId, kind, detail, studiedMs, nowMs })
        : (data.bursts ?? []);

      transaction.set(
        ref,
        { source: SOURCE, entries, bursts, updatedAt: Timestamp.fromMillis(nowMs) },
        { merge: true },
      );
    });

    return true;
  } catch {
    return false;
  }
}

/**
 * Counts study time for as long as an activity runs, flushing periodically.
 *
 * Time only accrues while the tab is visible, matching the signal: a question
 * set left open in a background tab is not studying, and reporting it as such
 * would corrupt exactly the totals this exists to fill in.
 *
 * @returns {() => void} stop, which flushes whatever is left
 */
export function trackStudyTime(kind, options = {}) {
  const detailOf = () =>
    typeof options.detail === "function" ? options.detail() : (options.detail ?? null);

  let lastTick = Date.now();
  let stopped = false;

  // One id per unbroken run of studying, so focus-hud can reconstruct the
  // sitting rather than a scatter of thirty-second fragments.
  let burstId = newBurstId();

  const accrue = () => {
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      // Time away breaks the sitting: coming back is a new burst, not a
      // continuation of one that appears to have lasted all afternoon.
      burstId = newBurstId();
      return;
    }

    // A machine asleep for hours must not report hours of study.
    if (elapsed > FLUSH_MS * 4) {
      burstId = newBurstId();
      return;
    }

    void reportStudyTime(kind, detailOf(), elapsed, now, burstId);
  };

  const timer = setInterval(accrue, FLUSH_MS);

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    accrue();
  };
}
