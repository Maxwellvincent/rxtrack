// Firestore's persistent multi-tab cache keeps coordination records in
// localStorage. They are derived cache metadata (not app/auth data), but can
// accumulate until a small browser localStorage quota is exhausted. Once that
// happens Firestore can fail with an internal assertion while updating a
// `firestore_targets_...` record.
//
// RXTrack treats the cloud as the source of truth and already maintains its own
// bounded local mirrors. It now uses Firestore's memory cache, so these legacy
// multi-tab records are no longer needed and are safe to remove once at boot.
export const FIRESTORE_SHARED_STATE_PREFIXES = Object.freeze([
  "firestore_clients_",
  "firestore_mutations_",
  "firestore_online_state_",
  "firestore_sequence_number_",
  "firestore_targets_",
  "firestore_zombie_",
]);

export function isLegacyFirestoreSharedStateKey(key) {
  return typeof key === "string"
    && FIRESTORE_SHARED_STATE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Remove only Firestore's obsolete multi-tab coordination metadata.
 *
 * Storage can be disabled or throw in hardened/private browser contexts, so
 * cleanup is deliberately best-effort and must never prevent app startup.
 */
export function clearLegacyFirestoreSharedState(storage = globalThis.localStorage) {
  if (!storage) return { removed: 0, failed: 0 };

  let removed = 0;
  let failed = 0;

  try {
    // Snapshot keys first; removing while walking Storage by numeric index can
    // otherwise skip the entry that shifts into the just-removed slot.
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (isLegacyFirestoreSharedStateKey(key)) keys.push(key);
    }

    for (const key of keys) {
      try {
        storage.removeItem(key);
        removed += 1;
      } catch {
        failed += 1;
      }
    }
  } catch {
    failed += 1;
  }

  return { removed, failed };
}
