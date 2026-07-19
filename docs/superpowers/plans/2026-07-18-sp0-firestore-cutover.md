# SP0 — Firestore Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move RXTrack's persistence + auth from Supabase (Postgres + Auth + Edge Function + Storage) to Firebase (Firestore + Auth + Cloud Function + Storage), keeping every exported function signature in `src/supabase.js` identical so external call-sites don't change, and migrating real Term 1 data.

**Architecture:** `src/supabase.js` is the single data-access choke-point (auth + push/pull/sync/mcq/images). We introduce `src/firebase.js` (SDK init + emulator wiring) and rewrite the *internals* of the data-access layer to Firestore while preserving its public API. Pure merge helpers (`mergeTerms`, `mergePerformance`, …) are reused untouched. The localStorage-cache + push/pull architecture is preserved for a minimal-risk cutover; Firestore offline persistence is enabled but the manual sync stays (simplifying it is a deferred follow-on). Tests run against the Firebase Local Emulator Suite.

**Tech Stack:** React 19 + Vite 7, Firebase Web SDK v11 (modular: `firebase/app`, `firebase/auth`, `firebase/firestore`, `firebase/storage`), Firebase Cloud Functions (Node), Vitest 3 + `@firebase/rules-unit-testing` / emulator.

## Global Constraints

- **Preserve public API:** every currently-exported symbol in `src/supabase.js` MUST keep its exact name and signature. New backend file is `src/firebase.js`; the data layer is refactored in place or re-exported so imports like `import { pushAllLocalDataToSupabase } from "./supabase"` keep working. (Rename to `src/cloud.js` is a deferred cleanup, NOT part of SP0.)
- **No data loss:** all writes stay read-merge-write additive (reuse existing merge helpers). Migration is copy-only; Supabase data is left intact until Louis confirms.
- **Env vars:** Firebase config via `import.meta.env.VITE_FIREBASE_*` (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). Keep a stub-client fallback when unset (mirrors current `makeStubClient` so an empty `.env` boots the app logged-out, not crashed).
- **Auth provider:** Google OAuth via Firebase Auth. Redirect target = `window.location.origin`.
- **Node/tooling:** Firebase CLI (`firebase`) for init/emulators/deploy. Firestore + Auth + Storage + Functions emulators for tests.
- **Test gate:** existing suite stays green (was 77/77). New adapter tests run against the Firestore emulator, not live Firebase.
- **Firestore layout (canonical):**
  - `users/{uid}/state/{name}` — name ∈ {terms, performance, completion, weak_concepts, tracker}; doc `{ data, updatedAt }`
  - `users/{uid}/objectives/{blockId}` — `{ data, updatedAt }`
  - `users/{uid}/lectures/{lectureId}` — `{ data, chunks, blockId, termId, updatedAt }`
  - `users/{uid}/kv/{key}` — `{ data, updatedAt }`
  - `users/{uid}/mcq/{objectiveId}__r{round}` — `{ objectiveId, round, data, updatedAt }`
  - `users/{uid}/questionImages/{autoId}` — `{ objectiveId, round, storagePath, filename, mimeType, addedAt }`; file in Storage at `question-images/{uid}/{objectiveId}_r{round}/{name}`
  - `users/{uid}/ankiCards/{id}`, `users/{uid}/recognitionItems/{id}`, `users/{uid}/ungeneratedCards/{id}` (from migrations 0001-0004)
- **Security rules (per-collection, NOT a catch-all — R4-finding 5):** rules are **enumerated per collection** under `users/{uid}` (Task 1), all owner-gated (`request.auth.uid == uid`), because Firestore ORs matching rules so a recursive `{document=**}` write grant would defeat any tighter rule. `recognitionItems` is **server-write-only** (`allow write: if false`; Admin/Functions bypass); `ankiCards`/`ungeneratedCards`/state/objectives/lectures/kv/mcq/questionImages are client read/write. NOTE (R2-finding 2): rules have **no serialized byte-size check** (`request.resource.size()` counts map keys, not bytes) — the 1 MiB doc limit is enforced by **(a)** an app-side guard that **logs + skips** an oversized write (`if (JSON.stringify(v).length > 900_000) { errors.push(...); return; }` — no silent shard in SP0) and **(b)** Firestore's hard 1 MiB write error caught into `errors[]`. Storage writes ARE byte/contentType gated in rules (Task 1 — Storage `request.resource.size` IS bytes). Full per-field Firestore schema validation is OUT of scope (single-user app) — REVIEW-LOG finding 6.
- **`uid` normalization (finding 2):** the app is wired around `user.id`; Firebase `User` uses `user.uid`. `getCurrentUser()` and `onAuthChange(cb)` MUST return/emit a normalized object `{ ...user, id: user.uid }` so no downstream call-site changes.
- **Reversible doc-ids (finding 9):** dynamic doc ids (blockId, lectureId, objectiveId, mcq key, storage segments) may contain `/`, spaces, or long imported strings. All dynamic ids go through `encodeDocId(s)` / `decodeDocId(s)` (Task 4). Never pass a raw id to `doc(...)`.
- **Batched writes (finding 14):** all multi-doc writes go through `commitInChunks(writes, 400)` (≤500 Firestore batch limit, chunk 400) with per-chunk try/catch that pushes to `errors[]`. No unbounded `writeBatch`.
- **Transactional merges (finding 11):** the read-merge-write state docs (terms/performance/completion/weak_concepts/tracker) use `runTransaction` (read-in-txn → merge → write-in-txn) to avoid cross-device last-writer-wins. Append-only per-record docs for sessions is a noted SP-follow-on, not SP0.
- **Independent pull (finding 12):** `pullAllDataFromSupabase` must read each collection independently and return `{ empty: true }` only when ALL canonical stores are absent — never skip objectives/kv/mcq just because `state/terms` is missing.
- **Await MCQ push (finding 13):** `pushAllLocalDataToSupabase` awaits `pushMcqBankToSupabase` and folds its errors into the returned `errors[]` (no fire-and-forget).
- **All AI server-side (finding 5, Louis's Option A):** SP0 moves EVERY browser AI call (`VITE_GEMINI_API_KEY`/Anthropic in App.jsx, aiClient.js, DeepLearn.jsx, examParser.js, HistoStudy.jsx, LearningModel.jsx, recognition) behind authenticated Cloud Functions using `defineSecret`. No AI key ships in the client bundle after SP0. (Task 7 scope.)
- **Rollback path (rejects finding 20's dual-backend, keeps a revert path):** Supabase data is left INTACT until Task 9 live-verify passes. Rollback = revert the branch; Postgres data is untouched. No dual-backend.

---

## File Structure

- **Create `src/firebase.js`** — Firebase app/auth/firestore/storage init; stub fallback when env unset; emulator wiring under Vitest. Exports `app, auth, db, storage, isFirebaseConfigured`.
- **Modify `src/supabase.js`** — rewrite internals to Firestore, keep all exports. (Merge helpers unchanged.)
- **Create `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`** — Firebase project config + rules.
- **Create `functions/`** (Cloud Functions) — port `supabase/functions/generate-recognition-items` to `functions/index.js` (`generateRecognitionItems`).
- **Modify `src/recognitionBank.js`, `src/ankiCards.js`, `src/weakConcepts.js`, `src/calibration.js`, `src/PatientRecognition.jsx`, `src/AnkiSyncModal.jsx`** — swap the handful of direct `supabase.from(...)` calls to the Firestore equivalents (via helpers exported from `supabase.js`).
- **Modify `src/shell/Shell.jsx`, `src/App.jsx`** — swap the edge-function invoke URL/auth to the Cloud Function callable; auth call-sites already go through `signInWithGoogle`/`getCurrentUser`.
- **Create `scripts/migrate-supabase-to-firestore.mjs`** — one-time Node migration: read all Supabase rows for a user, write Firestore docs.
- **Create `src/firestoreAdapter.test.js`** — emulator-backed tests for the data layer.
- **Modify `.env.example`** — add `VITE_FIREBASE_*` keys.

---

## Task 1: Firebase project init + config files

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`
- Modify: `.env.example`

**Interfaces:**
- Produces: a Firebase project id (`VITE_FIREBASE_PROJECT_ID`) + rules files consumed by every later task's emulator/deploy.

- [ ] **Step 1: Create the Firebase project (manual, Louis-gated).** Louis runs `firebase login` in his shell (interactive — suggest he type `! firebase login`). Then create/select a project: `firebase projects:create rxtrack-<suffix>` or pick an existing one. Record the project id.

- [ ] **Step 2: Write `.firebaserc`**

```json
{
  "projects": { "default": "rxtrack-REPLACE_WITH_PROJECT_ID" }
}
```

- [ ] **Step 3: Write `firebase.json`**

```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "functions": { "source": "functions" },
  "emulators": {
    "auth": { "port": 9099 },
    "firestore": { "port": 8080 },
    "storage": { "port": 9199 },
    "functions": { "port": 5001 },
    "ui": { "enabled": true }
  }
}
```

- [ ] **Step 4: Write `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function owner(uid) { return request.auth != null && request.auth.uid == uid; }
    // IMPORTANT: Firestore rules OR together — a recursive {document=**} write grant
    // would re-enable writes to the server-only bank. So DON'T use a catch-all; enumerate
    // client-writable collections, and give recognitionItems read-only (R3-finding 6).
    match /users/{uid} {
      allow read, write: if owner(uid);            // the user profile doc
      match /state/{name}        { allow read, write: if owner(uid); }
      match /objectives/{blockId}{ allow read, write: if owner(uid); }
      match /lectures/{lecId}    { allow read, write: if owner(uid); }
      match /kv/{key}            { allow read, write: if owner(uid); }
      match /mcq/{id}            { allow read, write: if owner(uid); }
      match /ankiCards/{id}      { allow read, write: if owner(uid); }
      match /ungeneratedCards/{id}{ allow read, write: if owner(uid); } // client Anki-ingest writes; server marks generated
      match /questionImages/{id} { allow read, write: if owner(uid); }
      match /recognitionItems/{id}{ allow read: if owner(uid); allow write: if false; } // server-only (Admin bypasses)
    }
  }
}
```

- [ ] **Step 5: Write `storage.rules`**

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /question-images/{uid}/{allPaths=**} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if request.auth != null && request.auth.uid == uid
        && request.resource.size < 10 * 1024 * 1024
        && request.resource.contentType.matches('image/(png|jpeg|jpg|webp)');
      allow delete: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

- [ ] **Step 6: Write `firestore.indexes.json`** (R2-finding 14 — derive from the actual query shapes in Task 6; the image query does `where objectiveId == … && where round == … orderBy addedAt`, which needs a composite index). Add composites as the queries are written; start with:

```json
{
  "indexes": [
    { "collectionGroup": "questionImages", "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "objectiveId", "order": "ASCENDING" },
        { "fieldPath": "round", "order": "ASCENDING" },
        { "fieldPath": "addedAt", "order": "ASCENDING" }
      ] }
  ],
  "fieldOverrides": []
}
```
When the emulator/console reports a missing index for any `recognitionItems` weak-area query (e.g. `blockId + subject`), add it here and re-deploy — do NOT leave it empty and hit runtime failures.

- [ ] **Step 7: Append Firebase keys to `.env.example`**

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 8: Verify emulators boot.** Run: `firebase emulators:start --only firestore,auth,storage` → Expected: emulator UI at `localhost:4000`, Firestore on `8080`. Ctrl-C to stop.

- [ ] **Step 9: Commit**

```bash
git add firebase.json .firebaserc firestore.rules firestore.indexes.json storage.rules .env.example
git commit -m "chore(sp0): firebase project config + rules + emulator setup"
```

---

## Task 2: `src/firebase.js` — SDK init + stub fallback + emulator wiring

**Files:**
- Create: `src/firebase.js`
- Test: `src/firebase.test.js`

**Interfaces:**
- Produces: `export const app, auth, db, storage; export const isFirebaseConfigured: boolean`. Consumed by `supabase.js` and all data-layer code.

- [ ] **Step 1: Install SDK.** Run: `npm i firebase` → Expected: `firebase` in dependencies.

- [ ] **Step 2: Write the failing test** (`src/firebase.test.js`)

```js
import { describe, it, expect } from "vitest";
import { isFirebaseConfigured } from "./firebase";

describe("firebase init", () => {
  it("exports isFirebaseConfigured as a boolean", () => {
    expect(typeof isFirebaseConfigured).toBe("boolean");
  });
});
```

- [ ] **Step 3: Run test to verify it fails.** Run: `npx vitest run src/firebase.test.js` → Expected: FAIL (cannot resolve `./firebase`).

- [ ] **Step 4: Write `src/firebase.js`**

```js
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
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

// Under Vitest we always init against the emulator (projectId "demo-rxtrack").
const underTest = !!import.meta.env.VITEST;
export const app = initializeApp(underTest ? { projectId: "demo-rxtrack" } : (isFirebaseConfigured ? cfg : { projectId: "demo-unconfigured" }));
export const auth = getAuth(app);

// Offline persistence (findings 8, R2-9): persistent IndexedDB cache with the
// multi-tab manager; fall back to memory cache when IndexedDB is unavailable
// (private browsing / unsupported), so init never throws.
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache } from "firebase/firestore";
function makeDb() {
  if (underTest) return initializeFirestore(app, { localCache: memoryLocalCache() });
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

if (underTest) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
}
```

- [ ] **Step 5: Run test to verify it passes.** Run: `npx vitest run src/firebase.test.js` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/firebase.js src/firebase.test.js package.json package-lock.json
git commit -m "feat(sp0): firebase SDK init + emulator wiring"
```

---

## Task 3: Auth adapter (Firebase Auth Google) inside `src/supabase.js`

**Files:**
- Modify: `src/supabase.js` (auth section, lines ~60-101 + client export)
- Test: `src/authAdapter.test.js`

**Interfaces:**
- Consumes: `auth` from `src/firebase.js`.
- Produces (unchanged signatures): `signInWithGoogle(): Promise<void>`, `signOut(): Promise<void>`, `getCurrentUser(): Promise<User|null>`, `checkCloudHasData(userId): Promise<boolean>`, plus `isSupabaseConfigured` (now aliased to `isFirebaseConfigured`) and an `onAuthChange(cb)` helper wrapping `onAuthStateChanged`.

- [ ] **Step 1: Write the failing test** (`src/authAdapter.test.js`) — emulator-backed sign-in.

```js
import { describe, it, expect, beforeAll } from "vitest";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";
import { getCurrentUser } from "./supabase";

describe("auth adapter", () => {
  beforeAll(async () => {
    try { await createUserWithEmailAndPassword(auth, "t@t.com", "pw1234"); } catch {}
    await signInWithEmailAndPassword(auth, "t@t.com", "pw1234");
  });
  it("getCurrentUser returns the signed-in user", async () => {
    const u = await getCurrentUser();
    expect(u?.email).toBe("t@t.com");
  });
});
```

- [ ] **Step 2: Run against emulator to verify it fails.** Run (emulators up): `firebase emulators:exec --only auth,firestore "npx vitest run src/authAdapter.test.js"` → Expected: FAIL (getCurrentUser still calls Supabase).

- [ ] **Step 3: Replace the auth section of `src/supabase.js`.** Remove the Supabase client + `makeStubClient` and replace the AUTH block with:

```js
import { auth, db, storage, isFirebaseConfigured } from "./firebase";
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut as fbSignOut, onAuthStateChanged,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, collection, getDocs, query, where, limit, writeBatch, runTransaction, serverTimestamp,
} from "firebase/firestore";

export const isSupabaseConfigured = isFirebaseConfigured; // name preserved for callers

// Normalize Firebase User -> app shape (findings 2, R2-8). Firebase User fields
// are non-enumerable getters, so Object.assign drops them — build an explicit
// plain object and bind the one method callers use (getIdToken).
const normalize = (u) => (u ? {
  id: u.uid, uid: u.uid, email: u.email, displayName: u.displayName, photoURL: u.photoURL,
  getIdToken: (...a) => u.getIdToken(...a),
} : null);

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);            // primary (desktop-first)
  } catch (e) {
    if (["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e?.code)) {
      await signInWithRedirect(auth, provider);        // fallback (mobile/blocked)
    } else throw e;
  }
}
export async function signOut() { await fbSignOut(auth); }
export function getCurrentUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(normalize(u)); });
  });
}
export function onAuthChange(cb) { return onAuthStateChanged(auth, (u) => cb(normalize(u))); }
// Complete a pending redirect sign-in on boot (findings 3,4).
export async function completeRedirectSignIn() {
  try { const res = await getRedirectResult(auth); return normalize(res?.user ?? null); }
  catch { return null; }
}

export async function checkCloudHasData(userId) {
  if (!userId) return false;
  try {
    const termsSnap = await getDoc(doc(db, "users", userId, "state", "terms"));
    if (termsSnap.exists() && termsSnap.data()?.data) return true;
    const objSnap = await getDocs(query(collection(db, "users", userId, "objectives"), limit(1)));
    return !objSnap.empty;
  } catch { return false; }
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `firebase emulators:exec --only auth,firestore "npx vitest run src/authAdapter.test.js"` → Expected: PASS.

- [ ] **Step 5: Migrate ALL raw `supabase.*` auth call-sites and remove the `supabase` client export (finding 1).** The plan's "signatures preserved" only holds if the exported helpers replace every raw client use. Grep `supabase\.auth\.`, `import { supabase }`, `supabase.functions`, `getSessionFromUrl`, `INITIAL_SESSION`, `#access_token`, `onAuthStateChange` across `src/`. Replace: `supabase.auth.getUser()/getSession()` → `getCurrentUser()`; Supabase's `onAuthStateChange((_e,session)=>…)` + `{data:{subscription}}` → `onAuthChange(user=>…)` (returns an unsubscribe fn directly — update the boot/cleanup shape in `Shell.jsx`/`App.jsx`); call `completeRedirectSignIn()` once on boot before the auth gate resolves. Delete the `export const supabase` client. Boot states to manually test: initial load (no user), sign-in (popup), reload (session persists), sign-out, redirect-fallback return.

- [ ] **Step 6: Verify no raw Supabase client references remain.** Run: `grep -rn "supabase\.auth\|supabase\.functions\|export const supabase\|onAuthStateChange\|getSessionFromUrl" src/` → Expected: zero (all via `getCurrentUser`/`onAuthChange`/`completeRedirectSignIn`).

- [ ] **Step 7: Commit**

```bash
git add src/supabase.js src/authAdapter.test.js src/shell/Shell.jsx src/App.jsx
git commit -m "feat(sp0): Firebase Auth (popup+redirect) + uid normalization; drop supabase client export"
```

---

## Task 4: Firestore data adapter — one JSON-doc read/write primitive

**Files:**
- Modify: `src/supabase.js` (add private helpers + rewrite `fetchCloud`/`upsert` internals)
- Test: `src/firestoreAdapter.test.js`

**Interfaces:**
- Produces private helpers used by Tasks 5-6:
  - `stateRef(uid, name)` → DocRef `users/{uid}/state/{name}`
  - `readDoc(ref): Promise<any|null>` → returns `.data().data ?? null`
  - `writeDoc(ref, dataObj): Promise<void>` → `setDoc(ref, { data: dataObj, updatedAt: serverTimestamp() }, { merge: true })`

- [ ] **Step 1: Write the failing test** (`src/firestoreAdapter.test.js`)

```js
import { describe, it, expect, beforeAll } from "vitest";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "./firebase";
import { __test } from "./supabase"; // export the primitives under __test

describe("firestore doc primitives", () => {
  let uid;
  beforeAll(async () => {
    try { await createUserWithEmailAndPassword(auth, "d@d.com", "pw1234"); } catch {}
    const cred = await signInWithEmailAndPassword(auth, "d@d.com", "pw1234");
    uid = cred.user.uid;
  });
  it("writeDoc then readDoc round-trips the JSON value", async () => {
    const ref = __test.stateRef(uid, "terms");
    await __test.writeDoc(ref, [{ id: "t1", name: "Term 1" }]);
    const got = await __test.readDoc(ref);
    expect(got).toEqual([{ id: "t1", name: "Term 1" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `firebase emulators:exec --only auth,firestore "npx vitest run src/firestoreAdapter.test.js"` → Expected: FAIL (`__test` undefined).

- [ ] **Step 3: Add the primitives to `src/supabase.js`**

**First create the PURE id-codec module `src/idCodec.js`** (R2-finding 4: no Firebase/Vite imports, so the Node migration script can import it too):

```js
// src/idCodec.js — pure, dependency-free (importable from browser AND node)
export function encodeDocId(s) {
  return encodeURIComponent(String(s)).replace(/\./g, "%2E").replace(/^__/, "%5F%5F");
}
export function decodeDocId(s) { return decodeURIComponent(s); }
```

Then the primitives in `src/supabase.js`:

```js
// serverTimestamp/runTransaction already imported in the auth section.
import { encodeDocId, decodeDocId } from "./idCodec";

const stateRef = (uid, name) => doc(db, "users", uid, "state", name);
async function readDoc(ref) {
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data()?.data ?? null) : null;
}
async function writeDoc(ref, dataObj) {
  await setDoc(ref, { data: dataObj, updatedAt: serverTimestamp() }, { merge: true });
}
// Transactional read-merge-write for the shared state docs (finding 11).
// Returns the merged value so callers can write it back to localStorage (R2-finding 15).
async function mergeDoc(ref, localVal, mergeFn) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cloud = snap.exists() ? (snap.data()?.data ?? null) : null;
    const merged = mergeFn(cloud, localVal);
    tx.set(ref, { data: merged, updatedAt: serverTimestamp() }, { merge: true });
    return merged;
  });
}
// Chunked batch commit (finding 14): Firestore batch limit is 500; chunk 400.
async function commitInChunks(writeOps, errors, chunk = 400) {
  for (let i = 0; i < writeOps.length; i += chunk) {
    const batch = writeBatch(db);
    writeOps.slice(i, i + chunk).forEach((op) => op(batch));
    try { await batch.commit(); }
    catch (e) { errors.push({ store: "batch", error: { message: e?.message || String(e) } }); }
  }
}

export const __test = { stateRef, readDoc, writeDoc, mergeDoc, commitInChunks, encodeDocId, decodeDocId };
```

Note: Task 5 uses `mergeDoc(stateRef(uid,name), localVal, mergeFn)` for the 5 state stores; `commitInChunks` for the per-doc lectures/objectives/kv/mcq collections. Task 6/8 use `encodeDocId` for every dynamic doc id and storage path segment.

- [ ] **Step 4: Run to verify it passes.** Run: `firebase emulators:exec --only auth,firestore "npx vitest run src/firestoreAdapter.test.js"` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/supabase.js src/firestoreAdapter.test.js
git commit -m "feat(sp0): firestore JSON-doc read/write primitives"
```

---

## Task 5: Rewrite push/pull to Firestore (state + objectives + lectures + kv)

**Files:**
- Modify: `src/supabase.js` (`pushAllLocalDataToSupabase`, `pullAllDataFromSupabase`, `pullUserKvFromSupabase`)
- Test: `src/firestoreAdapter.test.js` (add cases)

**Interfaces:**
- Consumes: primitives from Task 4; merge helpers (unchanged).
- Produces (unchanged signatures): `pushAllLocalDataToSupabase(userId)`, `pullAllDataFromSupabase(userId)`, `pullUserKvFromSupabase(userId)`.

**Mapping (mechanical — apply the same read-merge-write pattern per store):**
| localStorage key | Firestore ref | merge fn |
|---|---|---|
| `rxt-terms` | `state/terms` | `mergeTerms` |
| `rxt-performance` | `state/performance` | `mergePerformance` |
| `rxt-completion` | `state/completion` | `mergeCompletion` |
| `rxt-weak-concepts` | `state/weak_concepts` | `mergeWeakConcepts` |
| `rxt-tracker-v2` | `state/tracker` | `mergeKvValue` |
| `rxt-block-objectives` (per block) | `objectives/{blockId}` | `mergeBlockObjectives` |
| `rxt-lec-meta` (per lecture) | `lectures/{lectureId}` | union by id (never delete) |
| KV_KEYS[] | `kv/{key}` | `mergeKvValue` |

- [ ] **Step 1: Write failing test** — push then pull round-trips terms + one KV key.

```js
it("push writes state/terms, pull merges it back", async () => {
  localStorage.setItem("rxt-terms", JSON.stringify([{ id: "t1", blocks: [{ id: "b1" }] }]));
  const { pushAllLocalDataToSupabase, pullAllDataFromSupabase } = await import("./supabase");
  await pushAllLocalDataToSupabase(uid);
  localStorage.removeItem("rxt-terms");
  await pullAllDataFromSupabase(uid);
  expect(JSON.parse(localStorage.getItem("rxt-terms"))[0].id).toBe("t1");
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `firebase emulators:exec --only auth,firestore "npx vitest run src/firestoreAdapter.test.js"` → Expected: FAIL.

- [ ] **Step 3: Rewrite the push body — `mergeDoc` for state, `encodeDocId` + `commitInChunks` for collections (R3-findings 1).** Concrete:

```js
// 5 state stores: transactional merge, write merged back to localStorage
for (const [lsKey, name, mergeFn] of [
  ["rxt-terms","terms",mergeTerms], ["rxt-performance","performance",mergePerformance],
  ["rxt-completion","completion",mergeCompletion], ["rxt-weak-concepts","weak_concepts",mergeWeakConcepts],
  ["rxt-tracker-v2","tracker",mergeKvValue],
]) {
  const raw = localStorage.getItem(lsKey); if (!raw) continue;
  try {
    const merged = await mergeDoc(stateRef(userId, name), JSON.parse(raw), mergeFn);
    localStorage.setItem(lsKey, JSON.stringify(merged));
  } catch (e) { errors.push({ store: name, error: { message: e?.message || String(e) } }); }
}
// objectives per block — encode ids
const objStore = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
for (const [blockId, local] of Object.entries(objStore)) {
  try {
    const merged = await mergeDoc(doc(db,"users",userId,"objectives",encodeDocId(blockId)), local, mergeBlockObjectives);
    objStore[blockId] = merged;
  } catch (e) { errors.push({ store: `objectives:${blockId}`, error: { message: e?.message } }); }
}
localStorage.setItem("rxt-block-objectives", JSON.stringify(objStore));
// lectures — chunked batch, encoded ids, byte-guard each chunks blob
const lecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
const lecOps = lecs.map((l) => (b) => {
  const { chunks, ...meta } = l;
  b.set(doc(db,"users",userId,"lectures",encodeDocId(l.id)),
        { data: meta, chunks: chunks || [], blockId: l.blockId, termId: l.termId, updatedAt: serverTimestamp() }, { merge: true });
});
await commitInChunks(lecOps, errors);
// KV — encode keys, merge each
for (const key of KV_KEYS) {
  const raw = localStorage.getItem(key); if (!raw) continue;
  try {
    const merged = await mergeDoc(doc(db,"users",userId,"kv",encodeDocId(key)), JSON.parse(raw), mergeKvValue);
    localStorage.setItem(key, JSON.stringify(merged));
  } catch (e) { errors.push({ store: `kv:${key}`, error: { message: e?.message } }); }
}
```
Byte-guard (constraint, R4-finding 6): before any `set`, `if (JSON.stringify(v).length > 900_000) { errors.push({ store, error: { message: "oversized, skipped" } }); continue; }` — **log + skip, no silent shard in SP0** (a store that trips this is a signal to split its schema in a follow-on). Drop the old `networkDown`/`Failed to fetch` string checks — Firestore throws typed errors; catch → `errors[]`.

- [ ] **Step 4: Rewrite the pull body** symmetrically: `readDoc` each state ref, merge into localStorage using the same merge fns; `getDocs(collection(...,"objectives"))` and `...,"lectures")` for the per-doc collections; call `pullUserKvFromSupabase` (now reads `getDocs(collection(...,"kv"))`).

- [ ] **Step 5: Run to verify it passes.** Run: `firebase emulators:exec --only auth,firestore "npx vitest run src/firestoreAdapter.test.js"` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/supabase.js src/firestoreAdapter.test.js
git commit -m "feat(sp0): push/pull state+objectives+lectures+kv to Firestore"
```

---

## Task 6: MCQ bank + question images + recognition tables

**Files:**
- Modify: `src/supabase.js` (`saveMcqBankEntry`, `pullMcqBankFromSupabase`, `pushMcqBankToSupabase`, `uploadQuestionImage`, `fetchQuestionImages`, `deleteQuestionImage`)
- Modify: `src/recognitionBank.js`, `src/ankiCards.js`, `src/weakConcepts.js`, `src/calibration.js`, `src/PatientRecognition.jsx`, `src/AnkiSyncModal.jsx`
- Test: `src/firestoreAdapter.test.js` (mcq round-trip)

**Interfaces:**
- Produces (unchanged signatures): `saveMcqBankEntry(userId, objectiveId, round, data)`, `pullMcqBankFromSupabase(userId)`, `pushMcqBankToSupabase(userId)`, `uploadQuestionImage(userId, objectiveId, round, file): Promise<path|null>`, `fetchQuestionImages(userId, objectiveId, round): Promise<Array>`, `deleteQuestionImage(userId, storagePath)`.

- [ ] **Step 1: Write failing test** — mcq save then pull.

```js
it("saveMcqBankEntry then pull restores the question", async () => {
  const { saveMcqBankEntry, pullMcqBankFromSupabase } = await import("./supabase");
  await saveMcqBankEntry(uid, "obj1", 0, { stem: "Q?" });
  localStorage.removeItem("rxt-mcq-bank");
  await pullMcqBankFromSupabase(uid);
  const bank = JSON.parse(localStorage.getItem("rxt-mcq-bank"));
  expect(bank["obj1_r0"].stem).toBe("Q?");
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `firebase emulators:exec --only auth,firestore,storage "npx vitest run src/firestoreAdapter.test.js"` → Expected: FAIL.

- [ ] **Step 3: Rewrite MCQ functions (use `encodeDocId` + `commitInChunks`, R2-finding 3).** `saveMcqBankEntry` → `setDoc(doc(db,"users",userId,"mcq",`${encodeDocId(objectiveId)}__r${round??0}`), { objectiveId, round: round??0, data, updatedAt: serverTimestamp() })` + keep the localStorage cache write. `pushMcqBankToSupabase` → build write-ops and call `commitInChunks(ops, errors)` (NOT a raw `writeBatch`). `pullMcqBankFromSupabase` → `getDocs(collection(db,"users",userId,"mcq"))`, rebuild the local `${objectiveId}_r${round}` cache keys from each doc's `objectiveId`/`round` fields (not from the encoded doc id).

- [ ] **Step 4: Rewrite image functions to Firebase Storage (encode path segments, R2-finding 3).** `uploadQuestionImage` → build `path = `question-images/${userId}/${encodeDocId(objectiveId)}_r${round??0}/${safeName}``, `uploadBytes(storageRef(storage, path), file)`, then `setDoc(doc(db,"users",userId,"questionImages",encodeDocId(path)), { objectiveId, round: round??0, storagePath: path, filename: file.name, mimeType: file.type, addedAt: serverTimestamp() })` (deterministic id from path = idempotent, matches migration). `fetchQuestionImages` → `getDocs(query(collection(db,"users",userId,"questionImages"), where("objectiveId","==",objectiveId), where("round","==",round??0), orderBy("addedAt")))`, `getDownloadURL` per `storagePath`. `deleteQuestionImage` → `deleteObject` + `deleteDoc`. (Import `ref as storageRef, uploadBytes, getDownloadURL, deleteObject` from `firebase/storage`; `orderBy` from `firebase/firestore`.)

- [ ] **Step 5: Swap direct `supabase.from(...)` call-sites in the 6 other files** to Firestore. Add exported helpers from `supabase.js`: `saveAnkiCards(uid, cards)` + `getAnkiCards(uid)` (client read/write `ankiCards`), `saveUngeneratedCards(uid, cards)` + `getUngeneratedCards(uid)` (client read/write `ungeneratedCards`), and `getRecognitionItems(uid)` (**read only** — `recognitionItems` is server-written by `buildRecognitionBank`, R4-finding 1). Do **NOT** add a client `saveRecognitionItems` helper — the rules deny it; all recognition-item writes go through the Cloud Function. Replace each file's inline query with a helper call. (Grep `supabase.from` across `src/` — zero results after this step.)

- [ ] **Step 6: Run to verify it passes.** Run: `firebase emulators:exec --only auth,firestore,storage "npx vitest run src/firestoreAdapter.test.js"` → Expected: PASS.

- [ ] **Step 7: Verify no Supabase references remain in `src/`.** Run: `grep -rn "supabase\.\(from\|storage\|auth\)\|@supabase/supabase-js" src/` → Expected: zero call-sites. **Move** `@supabase/supabase-js` from `dependencies` to `devDependencies` (R2-finding 7) — the migration script (Task 8) still imports it; delete it only after Task 9 verify + one term's safety window.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sp0): mcq bank + question images + recognition tables on Firestore"
```

---

## Task 7: All AI behind Cloud Functions v2 (keys server-side)

**Scope note (findings 5, 17, 18):** not just porting one edge function — this moves EVERY browser AI call server-side (Louis's Option A) and PRESERVES the existing client callable contract.

**Files:**
- Create: `functions/index.js`, `functions/package.json`
- Modify callers: `src/recognitionBank.js` (`triggerBankBuild`), `src/aiClient.js` (`callAI`/`callAIJSON`), and confirm `App.jsx`/`DeepLearn.jsx`/`examParser.js`/`HistoStudy.jsx`/`LearningModel.jsx` route through `aiClient` (grep `VITE_GEMINI_API_KEY`, `generativelanguage.googleapis.com`, `api.anthropic.com` — zero client hits after this task).
- Reference: `supabase/functions/generate-recognition-items/index.ts` (port its Gemini + card-selection logic).

**Interfaces:**
- Produces callables that PRESERVE existing client contracts (finding 17):
  - `buildRecognitionBank({ userId, blockId, perCard, batch, weakSubjects })` → `{ generated, processed, remaining, provider }` — server-side card selection via Admin SDK reading `users/{uid}/ankiCards` + `ungeneratedCards`, writing `recognitionItems` (mirrors the edge fn's server-side select-and-insert; do NOT collapse to `{cards}→{items}`).
  - `aiComplete({ prompt, json, model })` → `{ text }` or `{ data }` — generic gateway that ALL other AI calls (`aiClient.callAI`/`callAIJSON`) proxy to (finding 5).
- Consumes: `defineSecret("GEMINI_API_KEY")`, `defineSecret("ANTHROPIC_API_KEY")` (finding 18); client uses `getFunctions(app)` + `httpsCallable`.

- [ ] **Step 1: Init functions + secrets (finding 18).** Run: `firebase init functions` (JavaScript). Define secrets (NOT `functions:config:set`): `firebase functions:secrets:set GEMINI_API_KEY` and `…ANTHROPIC_API_KEY`. In `functions/index.js`: `const { defineSecret } = require("firebase-functions/params"); const GEMINI = defineSecret("GEMINI_API_KEY"); const ANTHROPIC = defineSecret("ANTHROPIC_API_KEY");`.

- [ ] **Step 2: Write `buildRecognitionBank` preserving the contract (finding 17).** Port the Deno fn's server-side card-selection + Gemini generation into an Admin-SDK callable:

```js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineString } = require("firebase-functions/params");
const admin = require("firebase-admin"); admin.initializeApp();
const db = admin.firestore();
const ALLOWED = defineString("ALLOWED_UIDS"); // R3-8: param, not process.env; set at deploy
function assertAllowed(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "sign in required");
  const list = (ALLOWED.value() || "").split(",").filter(Boolean);
  if (list.length && !list.includes(req.auth.uid)) throw new HttpsError("permission-denied", "not allowlisted");
}

exports.buildRecognitionBank = onCall({ secrets: [GEMINI] }, async (req) => {
  assertAllowed(req);
  const uid = req.auth.uid;
  const { userId, blockId, perCard = 2, batch = 20, weakSubjects = [] } = req.data || {};
  if (userId && userId !== uid) throw new HttpsError("permission-denied", "userId mismatch"); // R3-7
  // 1. select ungenerated cards for this block (Admin read users/{uid}/ungeneratedCards, weak-weighted)
  // 2. call Gemini with GEMINI.value() (port prompt from the Deno fn verbatim)
  // 3. write users/{uid}/recognitionItems/{deterministicId} (Admin bypasses read-only rule); mark cards generated
  return { generated, processed, remaining, provider: "gemini" };
});
```

- [ ] **Step 3: Write `aiComplete` gateway covering ALL call shapes (findings 5, R2-10/11/12).** Must cover every existing browser AI shape — plain text, JSON, **image/OCR** (`callAIWithImage`), system+user prompt pairs, `maxTokens`, and provider fallback. Restrict to the single user (R2-12) via a UID allowlist + require auth (R2-11):

```js
// assertAllowed defined in Step 2 (shared).
exports.aiComplete = onCall({ secrets: [GEMINI, ANTHROPIC] }, async (req) => {
  assertAllowed(req);
  const { system, prompt, images = [], json = false, maxTokens = 2048, model = "gemini" } = req.data || {};
  const key = model === "claude" ? ANTHROPIC.value() : GEMINI.value();
  // Build the provider request server-side: system+user prompt, inline image
  // parts (base64) when images[] present, maxTokens; on primary failure fall
  // back to the other provider. Parse JSON when json=true.
  return json ? { data } : { text };
});
```

`ALLOWED_UIDS` is set at deploy via `firebase deploy --only functions` after `firebase functions:params:set ALLOWED_UIDS="<louis-uid>"` (or a `.env` in `functions/`); the emulator reads it from `functions/.env.local`. App Check is recommended before any public deploy; the UID allowlist is the MVP guard against quota abuse.

- [ ] **Step 4: Test the handlers IN-PROCESS with mocked fetch (R2-finding 13).** A Vitest `global.fetch` mock does NOT reach a separate emulator process, so unit-test the exported handler logic directly (import the handler module, inject a fake `req` with `auth.uid` + `data`, stub the provider `fetch`). Keep the emulator only for the auth/firestore integration bits. Run: `npx vitest run functions/handlers.test.js` — assert `buildRecognitionBank` returns `{ generated, processed, remaining, provider }` and writes `recognitionItems`; `aiComplete` returns `{ text }`/`{ data }` and enforces the allowlist → Expected: PASS.

- [ ] **Step 5: Swap all callers to the callables (explicit mapping, R3-9/10).** Route the whole `aiClient` surface through `aiComplete`, then confirm every direct-Gemini file goes through `aiClient`:

```js
// src/aiClient.js — all three shapes proxy to the one callable
const call = httpsCallable(getFunctions(app), "aiComplete");
export const callAI        = ({ system, prompt, maxTokens, model }) => call({ system, prompt, maxTokens, model }).then(r => r.data.text);
export const callAIJSON    = ({ system, prompt, maxTokens, model }) => call({ system, prompt, json: true, maxTokens, model }).then(r => r.data.data);
export const callAIWithImage = ({ system, prompt, images, maxTokens, model }) => call({ system, prompt, images, maxTokens, model }).then(r => r.data.text);
```
`recognitionBank.triggerBankBuild()` → `httpsCallable(getFunctions(app), "buildRecognitionBank")({ userId, blockId, perCard, batch, weakSubjects })`, read `.data.{generated,processed,remaining,provider}` (downstream unchanged). Then **rewrite every direct-Gemini caller** — `App.jsx`, `DeepLearn.jsx`, `examParser.js`, `HistoStudy.jsx`, `LearningModel.jsx` — to import from `aiClient` instead of hitting the API directly, and delete all `VITE_GEMINI_API_KEY` usage.

- [ ] **Step 6: Zero-hit gate + deploy.** Run: `grep -rn "generativelanguage.googleapis.com\|api.anthropic.com\|VITE_GEMINI_API_KEY\|VITE_ANTHROPIC" src/` → Expected: **zero**. Then set the allowlist param and deploy: `firebase functions:params:set ALLOWED_UIDS="<louis-uid>"; firebase deploy --only functions` → Expected: `buildRecognitionBank`, `aiComplete` deployed, no errors.

- [ ] **Step 7: Commit (all direct callers included)**

```bash
git add functions src/recognitionBank.js src/aiClient.js src/App.jsx src/DeepLearn.jsx src/examParser.js src/HistoStudy.jsx src/LearningModel.jsx .env.example
git commit -m "feat(sp0): all AI behind Cloud Functions v2 (defineSecret + allowlist); preserve bank-build contract"
```

---

## Task 8: One-time Term 1 data migration (Supabase → Firestore)

**Files:**
- Create: `scripts/migrate-supabase-to-firestore.mjs`

**Interfaces:**
- Consumes: Supabase service creds (read) + Firebase Admin creds (write), both via env — never committed.
- Produces: Louis's Term 1 data copied into Firestore under his Firebase uid.

- [ ] **Step 1: Write the migration script.** Reads each Supabase table for the user, writes the mapped Firestore docs. Real logic:

```js
import { createClient } from "@supabase/supabase-js";
import admin from "firebase-admin";
import crypto from "node:crypto";
import { encodeDocId } from "../src/idCodec.js"; // pure module — safe in node (R3-finding 2)

const sb = createClient(process.env.SB_URL, process.env.SB_SERVICE_KEY);
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

const SB_UID = process.env.SB_UID;      // Supabase user id (source)
const FB_UID = process.env.FB_UID;      // Firebase uid (target)
const srcHash = (row) => crypto.createHash("sha1").update(JSON.stringify(row)).digest("hex"); // R3-finding 4

const STATE = ["terms","performance","completion","weak_concepts","tracker"];
for (const name of STATE) {
  const { data } = await sb.from(name).select("data,updated_at").eq("user_id", SB_UID).maybeSingle();
  if (data?.data) await db.doc(`users/${FB_UID}/state/${name}`).set({ data: data.data, srcHash: srcHash(data), srcUpdatedAt: data.updated_at ?? null, updatedAt: new Date() });
}
// objectives (per block) — encoded id + srcHash (R3-findings 3,4)
const { data: objs } = await sb.from("objectives").select("block_id,data,updated_at").eq("user_id", SB_UID);
for (const o of objs || []) await db.doc(`users/${FB_UID}/objectives/${encodeDocId(o.block_id)}`).set({ data: o.data, srcHash: srcHash(o), srcUpdatedAt: o.updated_at ?? null, updatedAt: new Date() });
// lectures — encoded id + srcHash
const { data: lecs } = await sb.from("lectures").select("lecture_id,block_id,term_id,data,chunks,updated_at").eq("user_id", SB_UID);
for (const l of lecs || []) await db.doc(`users/${FB_UID}/lectures/${encodeDocId(l.lecture_id)}`).set({ data: l.data, chunks: l.chunks || [], blockId: l.block_id, termId: l.term_id, srcHash: srcHash(l), srcUpdatedAt: l.updated_at ?? null, updatedAt: new Date() });
// user_kv — encoded key + srcHash
const { data: kv } = await sb.from("user_kv").select("key,data,updated_at").eq("user_id", SB_UID);
for (const r of kv || []) await db.doc(`users/${FB_UID}/kv/${encodeDocId(r.key)}`).set({ data: r.data, srcHash: srcHash(r), srcUpdatedAt: r.updated_at ?? null, updatedAt: new Date() });
// mcq_bank (deterministic id = idempotent on rerun) — encodeDocId imported at top from idCodec
const { data: mcq } = await sb.from("mcq_bank").select("objective_id,round,data,updated_at").eq("user_id", SB_UID);
for (const m of mcq || []) await db.doc(`users/${FB_UID}/mcq/${encodeDocId(m.objective_id)}__r${m.round ?? 0}`).set({ objectiveId: m.objective_id, round: m.round ?? 0, data: m.data, srcHash: srcHash(m), srcUpdatedAt: m.updated_at ?? null, updatedAt: new Date() });

// recognition tables (finding 16) — anki_cards, recognition_items, ungenerated_cards
for (const [table, coll] of [["anki_cards","ankiCards"],["recognition_items","recognitionItems"],["ungenerated_cards","ungeneratedCards"]]) {
  const { data: rows } = await sb.from(table).select("*").eq("user_id", SB_UID);
  for (const r of rows || []) {
    const id = encodeDocId(r.id ?? r.card_id ?? `${r.deck||""}_${r.note_id||""}`); // deterministic from source PK
    await db.doc(`users/${FB_UID}/${coll}/${id}`).set({ ...r, srcHash: srcHash(r), srcUpdatedAt: r.updated_at ?? r.created_at ?? null, updatedAt: new Date() });
  }
}

// question_images (finding 15/16) — copy Storage file + meta, deterministic id from storage_path
const { data: imgs } = await sb.from("question_images").select("*").eq("user_id", SB_UID);
for (const im of imgs || []) {
  const { data: file } = await sb.storage.from("question-images").download(im.storage_path);
  // Rewrite path to the Firebase layout + FB_UID (R2-finding 6); encode filename too (R3-finding 12).
  const dest = `question-images/${FB_UID}/${encodeDocId(im.objective_id)}_r${im.round ?? 0}/${encodeDocId(im.filename)}`;
  if (file) {
    const buf = Buffer.from(await file.arrayBuffer());
    await admin.storage().bucket().file(dest).save(buf, { contentType: im.mime_type || "image/jpeg" });
  }
  const id = encodeDocId(dest); // deterministic from NEW path → idempotent
  // Store BOTH the original filename and the encoded storage basename (R4-finding 4) so
  // reverse-export knows what to restore vs how to locate the object.
  await db.doc(`users/${FB_UID}/questionImages/${id}`).set({ objectiveId: im.objective_id, round: im.round ?? 0, storagePath: dest, filename: im.filename, storageFilename: encodeDocId(im.filename), mimeType: im.mime_type, srcHash: srcHash(im), srcUpdatedAt: im.added_at ?? null, addedAt: im.added_at || new Date() });
}
console.log("migration complete");
```

RPC-backed data (`ungenerated_cards` / `ungenerated_count`): these are Postgres RPCs computing over `anki_cards`; after copying `anki_cards`/`ungenerated_cards` above, the Firestore `buildRecognitionBank` function recomputes the "ungenerated" set from `ankiCards` docs — no RPC to port. Confirm counts match post-migration (Step 4 verify).

Idempotency: every `.set()` above uses a **deterministic id derived from the source primary key / storage path**, so rerunning overwrites in place instead of duplicating (fixes finding 15's `autoId` duplication).

- [ ] **Step 2: Dry-run count + size audit (findings 10, 15).** Add flags: `--count` (row counts, no writes), `--sizes` (byte size of each state-doc JSON — flag any >700 KB approaching Firestore's 1 MiB limit), `--verify` (post-migration: compare Firestore doc counts to Supabase row counts), `--resume` (skip a doc only when its stored `srcHash` equals a hash of the source row — NOT `updatedAt`, which the migration regenerates each run, R2-finding 16; every migrated doc also stores `srcHash` + the source `updated_at`/`created_at` where available). Run: `node scripts/migrate-supabase-to-firestore.mjs --count --sizes` → Expected: non-zero counts matching Term 1; **if any state doc >700 KB, shard it** (performance/completion by block; lectures already per-doc) before the real run.

- [ ] **Step 3: Run the migration into the emulator first.** Point Admin SDK at the Firestore emulator (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`) and run; then start the app against the emulator and confirm Term 1 renders (terms, 350 objectives).

- [ ] **Step 4: Run the migration into live Firestore** (Louis-gated, after emulator verify): unset the emulator host, provide real Admin creds, run once. Verify in the Firebase console.

- [ ] **Step 5: Commit the script (no creds).**

```bash
git add scripts/migrate-supabase-to-firestore.mjs
git commit -m "feat(sp0): one-time Supabase→Firestore data migration script"
```

---

## Task 9: Security-rule tests + live end-to-end verification

**Files:**
- Create: `src/rules.test.js` (security-rule tests via `@firebase/rules-unit-testing`)

- [ ] **Step 0: Security-rule + hardening tests (findings 19, R3-5).** Install `@firebase/rules-unit-testing`. Assert against the emulator: (a) user A **cannot** read/write `users/{B}/...` (cross-user denial); (b) a client write to `users/{A}/recognitionItems` is **denied** (server-only, R3-6) while a read is allowed, and a client write to `users/{A}/ankiCards`/`ungeneratedCards` is **allowed** (client Anki ingest); (c) a Storage write with `contentType:"application/pdf"` is denied, `image/png` allowed, and a >10 MB image denied; (d) `encodeDocId`/`decodeDocId` round-trips ids containing `/`, spaces, `.`, and a 200-char string. **Byte-size is NOT a rules test** (R3-5): instead a plain unit test asserts the adapter's app-side guard splits/logs a >900 KB value and that a genuine >1 MiB Firestore write rejection is caught into `errors[]`. Run: `firebase emulators:exec --only firestore,storage,auth "npx vitest run src/rules.test.js"` → Expected: PASS.
- [ ] **Step 1: Configure `.env`** with the real `VITE_FIREBASE_*` values.
- [ ] **Step 2: Enable Google sign-in** in Firebase console (Auth → Sign-in method → Google) and add `localhost` to authorized domains.
- [ ] **Step 3: Build + run.** Run: `npm run build` (Expected: clean) then `npm run dev`.
- [ ] **Step 4: Drive the app in the browser** (use the run/claude-in-chrome flow): load `localhost:5174`, **sign in with Google**, confirm Term 1 data loads (sidebar terms, FTM 2 = 350 objectives), open a block, start an adaptive session, answer an item, confirm the session result **persists** (reload → still there), confirm Patient Recognition pulls from the bank. Read the console for errors — Expected: none.
- [ ] **Step 5: Confirm a fresh write round-trips to Firestore** (make an edit, check the doc appears in the Firebase console).
- [ ] **Step 6: Commit a short verification note** to `docs/superpowers/plans/2026-07-18-sp0-firestore-cutover.md` (check the boxes) and tag the branch.
- [ ] **Step 7: Rollback criteria + post-cutover reversal (findings 20, R2-17).** Two distinct windows:
  - **Pre-first-write rollback (clean):** between merge and Louis's first real Firebase write, rollback = revert the branch; Supabase data is untouched. Do the Step 0-6 verification in THIS window so a failure reverts cleanly with zero data loss.
  - **Post-cutover reversal (lossy without a bridge):** once Louis studies on Firebase, reverting the branch loses those writes. So ALSO ship `scripts/export-firestore-to-supabase.mjs` (reverse of Task 8: read `users/{uid}/**`, upsert back into the Supabase tables) as the post-cutover escape hatch, and keep the Supabase project **read-write-capable for one term** (not just read-only) so the reverse replay can land. Only delete Supabase after a full term on Firebase with no rollback needed.

---

## Task 10: Reverse-migration escape hatch (`export-firestore-to-supabase.mjs`)

**Files:** Create `scripts/export-firestore-to-supabase.mjs` (R3-finding 11 — the rollback plan references this; make it real).

**Interfaces:** Consumes Firebase Admin (read) + Supabase service creds (write). Produces: Louis's Firebase data replayed back into Supabase tables (the post-cutover rollback path).

- [ ] **Step 1: Write the reverse script** — the inverse of Task 8, using the SAME `decodeDocId` (from `src/idCodec.js`) to recover source keys:

```js
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";
import { decodeDocId } from "../src/idCodec.js";
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const fdb = admin.firestore();
const sb = createClient(process.env.SB_URL, process.env.SB_SERVICE_KEY);
const FB_UID = process.env.FB_UID, SB_UID = process.env.SB_UID;

// state -> single-row tables
for (const name of ["terms","performance","completion","weak_concepts","tracker"]) {
  const snap = await fdb.doc(`users/${FB_UID}/state/${name}`).get();
  if (snap.exists) await sb.from(name).upsert({ user_id: SB_UID, data: snap.data().data, updated_at: new Date() }, { onConflict: "user_id" });
}
// objectives (decode id -> block_id)
for (const d of (await fdb.collection(`users/${FB_UID}/objectives`).get()).docs)
  await sb.from("objectives").upsert({ user_id: SB_UID, block_id: decodeDocId(d.id), data: d.data().data, updated_at: new Date() }, { onConflict: "user_id,block_id" });
// lectures (decode id -> lecture_id)
for (const d of (await fdb.collection(`users/${FB_UID}/lectures`).get()).docs) {
  const v = d.data();
  await sb.from("lectures").upsert({ user_id: SB_UID, lecture_id: decodeDocId(d.id), block_id: v.blockId, term_id: v.termId, data: v.data, chunks: v.chunks || [], updated_at: new Date() }, { onConflict: "user_id,lecture_id" });
}
// kv (decode id -> key)
for (const d of (await fdb.collection(`users/${FB_UID}/kv`).get()).docs)
  await sb.from("user_kv").upsert({ user_id: SB_UID, key: decodeDocId(d.id), data: d.data().data, updated_at: new Date() }, { onConflict: "user_id,key" });
// mcq (id = `${encodedObjId}__r${round}` -> split)
for (const d of (await fdb.collection(`users/${FB_UID}/mcq`).get()).docs) {
  const v = d.data();
  await sb.from("mcq_bank").upsert({ user_id: SB_UID, objective_id: v.objectiveId, round: v.round ?? 0, data: v.data, updated_at: new Date() }, { onConflict: "user_id,objective_id,round" });
}
// recognition tables
for (const [coll, table] of [["ankiCards","anki_cards"],["recognitionItems","recognition_items"],["ungeneratedCards","ungenerated_cards"]]) {
  for (const d of (await fdb.collection(`users/${FB_UID}/${coll}`).get()).docs) {
    const { srcHash, srcUpdatedAt, updatedAt, ...row } = d.data();
    await sb.from(table).upsert({ ...row, user_id: SB_UID }, { onConflict: "user_id,id" });
  }
}
// question_images: reverse-copy Storage object + meta
for (const d of (await fdb.collection(`users/${FB_UID}/questionImages`).get()).docs) {
  const v = d.data();
  const [file] = await admin.storage().bucket().file(v.storagePath).download().catch(() => [null]);
  const sbPath = `${SB_UID}/${encodeURIComponent(v.objectiveId)}_r${v.round ?? 0}/${v.filename}`;
  if (file) await sb.storage.from("question-images").upload(sbPath, file, { contentType: v.mimeType || "image/jpeg", upsert: true });
  await sb.from("question_images").upsert({ user_id: SB_UID, objective_id: v.objectiveId, round: v.round ?? 0, storage_path: sbPath, filename: v.filename, mime_type: v.mimeType }, { onConflict: "user_id,storage_path" });
}
console.log("reverse export complete");
```

- [ ] **Step 2: Dry-run against the emulator** — seed the Firestore emulator, run with `--count`, confirm row counts match. Run: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node scripts/export-firestore-to-supabase.mjs --count`.
- [ ] **Step 3: Commit (no creds).**

```bash
git add scripts/export-firestore-to-supabase.mjs
git commit -m "feat(sp0): reverse Firestore->Supabase export (post-cutover rollback path)"
```

---

## Self-Review

**Spec coverage (§11 SP0):** Firebase Auth ✅(T3) · Firestore ✅(T4-6) · `supabase.js`→adapter same signatures ✅(T3-6, Global Constraints) · edge fn→Cloud Function ✅(T7) · Term 1 data migration ✅(T8) · offline persistence — enabled in T2 init (note: full sync-simplification deferred per spec) · **live verify** ✅(T9). Dual-backend explicitly avoided (Global Constraints). Firestore layout matches spec §12 collections that pre-exist; new cycle collections (learner_model, lesson_runs, …) are SP2, not SP0.

**Placeholder scan:** the two "port verbatim" steps (T7 Gemini body, T8 Storage file copy) reference concrete existing sources to copy — not vague instructions. Per-table push/pull in T5 is a stated mechanical mapping table, not a placeholder.

**Type consistency:** doc shape `{ data, updatedAt }` is uniform across T4-6 and T8; mcq key format `${objectiveId}__r${round}` in Firestore vs the localStorage cache key `${objectiveId}_r${round}` is intentional (Firestore doc ids can't contain nothing problematic, `__r` chosen to avoid collision) — pull rebuilds the `_r` cache key in T6 Step 3.

---

## Notes for execution

- Per Louis's CLAUDE.md, this is backend work → run it through `/ecc:multi-backend` (Codex-led) or at minimum a `/codex-review` on this plan before building. High-stakes (auth + data migration) — cross-model review warranted.
- Firebase MCP tools + the `firebase` skill are available in this environment for project/app creation and deploy.
- Commit after each task's verify (Louis runs parallel agents; uncommitted = provisional).
