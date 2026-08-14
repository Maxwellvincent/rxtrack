/**
 * Serialize upload queue metadata in sessionStorage for tab refresh.
 * PDF bytes are stored separately in IndexedDB (`uploadQueueBlobStore.js`).
 */

export const UPLOAD_QUEUE_SESSION_KEY = "rxt-upload-queue-v1";

export function normalizeRecoveredQueueItem(item) {
  if (!item || typeof item.id !== "string") return null;
  if (item.status === "done" || item.status === "error") return { ...item };
  /** Collision rows need the PDF for resolution; IndexedDB may restore it on load. */
  if (item.status === "collision") {
    return {
      ...item,
      restoredFromSession: true,
      statusLabel: "Restored — loading PDF…",
      error: null,
    };
  }
  return {
    ...item,
    status: "queued",
    progress: 0,
    error: null,
    statusLabel: "Restored — loading PDF…",
    restoredFromSession: true,
  };
}

export function loadUploadQueueFromSession() {
  try {
    const raw = sessionStorage.getItem(UPLOAD_QUEUE_SESSION_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeRecoveredQueueItem).filter(Boolean);
  } catch {
    return [];
  }
}

export function persistUploadQueueToSession(queue) {
  try {
    if (!queue?.length) {
      sessionStorage.removeItem(UPLOAD_QUEUE_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(UPLOAD_QUEUE_SESSION_KEY, JSON.stringify(queue));
  } catch {
    /* quota / private mode */
  }
}
