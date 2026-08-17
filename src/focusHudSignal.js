// ── focus-hud activity signal ────────────────────────────────────────────────
// Tells focus-hud what is being studied right now, so it can attribute time to
// the right area and lecture without the user starting a timer by hand.
//
// A single document per source, refreshed on a heartbeat and deleted when the
// activity ends. focus-hud treats a signal older than 90 seconds as gone, so an
// RXTrack tab that crashes cannot leave a session looking active forever.
//
// Contract: focus-hud/docs/rxtrack-contract.md

import { doc, setDoc, deleteDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "./firebase.js";
import { getStoreHookUserId } from "./shell/hooks/currentUser.js";

/** Must match focus-hud's staleness window; it is the reader's rule, not ours. */
export const HEARTBEAT_MS = 30_000;

const SOURCE = "rxtrack";

function signalRef(userId) {
  return doc(db, `users/${userId}/activitySignals/${SOURCE}`);
}

/**
 * Starts (or refreshes) a signal.
 *
 * Fire-and-forget by design: study must never block or fail because a companion
 * app's optional bookkeeping did not write.
 *
 * @param {"questions"|"lecture"|"review"} kind
 * @param {{detail?: string|null|(() => string|null), externalRef?: string|null, startedAt?: number}} [options]
 */
export async function beatFocusHud(kind, options = {}) {
  const userId = getStoreHookUserId();
  if (!userId) return false;

  try {
    await setDoc(
      signalRef(userId),
      {
        source: SOURCE,
        kind,
        // A function is evaluated at each beat, so the lecture on screen can
        // change without restarting the signal and resetting its start time.
        detail: (typeof options.detail === "function" ? options.detail() : options.detail) ?? null,
        externalRef: options.externalRef ?? null,
        startedAt: Timestamp.fromMillis(options.startedAt ?? Date.now()),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch {
    return false;
  }
}

/** Clears the signal when the activity ends. */
export async function stopFocusHud() {
  const userId = getStoreHookUserId();
  if (!userId) return;

  try {
    await deleteDoc(signalRef(userId));
  } catch {
    // Already gone, or offline. focus-hud's staleness rule covers it.
  }
}

/**
 * Keeps a signal alive for as long as an activity runs.
 *
 * Returns a stop function; call it when the activity ends. Heartbeats stop when
 * the tab is hidden, so leaving a question set open in a background tab does not
 * report hours of studying that never happened.
 *
 * `detail` may be a function, evaluated at each beat, so a session that moves
 * between lectures keeps reporting the current one.
 *
 * @returns {() => void}
 */
export function trackFocusHudActivity(kind, options = {}) {
  const startedAt = Date.now();
  let stopped = false;

  const beat = () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void beatFocusHud(kind, { ...options, startedAt });
  };

  beat();
  const timer = setInterval(beat, HEARTBEAT_MS);

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    void stopFocusHud();
  };
}
