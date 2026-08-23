/**
 * Task 10 — Tutor mode preference (local-only).
 *
 * Follows navPrefs.js's exact pattern: try/catch localStorage read/write, a
 * single JSON blob under one key. This is a per-device view preference, not
 * study data — same category as the sidebar collapse state navPrefs.js
 * handles, not something that needs to sync across devices.
 */

export const TUTOR_MODE_KEY = "rxt-exam-tutor-mode";

/** Whether Tutor mode is on for this device. Defaults to false (off). */
export function readTutorModeEnabled() {
  try {
    const raw = JSON.parse(localStorage.getItem(TUTOR_MODE_KEY) || "{}");
    return !!(raw && typeof raw === "object" && raw.enabled === true);
  } catch {
    return false;
  }
}

export function writeTutorModeEnabled(enabled) {
  try {
    localStorage.setItem(TUTOR_MODE_KEY, JSON.stringify({ enabled: !!enabled }));
  } catch { /* preference only — losing it costs nothing */ }
}
