import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { clearLegacyFirestoreSharedState } from "./firestoreCachePolicy.js";

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = !!(cfg.apiKey && cfg.projectId);

// getAuth() validates that apiKey + authDomain are PRESENT even for the emulator
// (Task-2 fix: {projectId} alone throws auth/invalid-api-key). So the test and
// empty-.env branches use a dummy-but-present config; isFirebaseConfigured still
// gates real cloud use, and an empty .env boots logged-out instead of crashing.
const underTest = !!import.meta.env.VITEST;
// Dev-only escape hatch: point a `npm run dev` session at the local emulator
// suite so UI can be driven in a real browser without reading or writing the
// live account. Set VITE_FIREBASE_EMULATORS=1 alongside `firebase emulators:start`.
const useEmulators = underTest || import.meta.env.VITE_FIREBASE_EMULATORS === "1";
const demoCfg = { apiKey: "demo-api-key", authDomain: "demo-rxtrack.firebaseapp.com", projectId: "demo-rxtrack" };
export const app = initializeApp(
  useEmulators ? demoCfg
  : isFirebaseConfigured ? cfg
  : { ...demoCfg, projectId: "demo-unconfigured", authDomain: "localhost" }
);
export const auth = getAuth(app);

// Firestore's persistent multi-tab cache writes coordination records into the
// browser's small localStorage quota. A full quota makes those writes throw
// asynchronously after initialization, so a surrounding try/catch cannot
// recover and Firestore can enter an internal assertion loop.
//
// Firestore is RXTrack's source of truth and app-owned local mirrors remain
// available for startup. Use the SDK's default-safe memory cache so multiple
// open tabs and a large study history cannot exhaust localStorage. Clean up the
// obsolete derived coordination records left by older builds before Firestore
// starts; this never touches Firebase Auth or `rxt-*` study data.
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
function makeDb() {
  if (!useEmulators) {
    const cleanup = clearLegacyFirestoreSharedState();
    if (cleanup.removed > 0) {
      console.info(`Firestore cache recovery: removed ${cleanup.removed} obsolete coordination record(s)`);
    }
  }
  return initializeFirestore(app, { localCache: memoryLocalCache() });
}
export const db = makeDb();
export const storage = getStorage(app);

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
