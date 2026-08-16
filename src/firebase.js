import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

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

// Offline persistence (findings 8, R2-9): persistent IndexedDB cache with the
// multi-tab manager; fall back to memory cache when IndexedDB is unavailable
// (private browsing / unsupported), so init never throws.
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from "firebase/firestore";
function makeDb() {
  if (useEmulators) return initializeFirestore(app, { localCache: memoryLocalCache() });
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    console.warn("Firestore persistent cache unavailable, using memory:", e?.message);
    return initializeFirestore(app, { localCache: memoryLocalCache() });
  }
}
export const db = makeDb();
export const storage = getStorage(app);

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
