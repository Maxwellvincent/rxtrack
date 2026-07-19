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
- **Security rule (all paths):** `allow read, write: if request.auth != null && request.auth.uid == uid;`

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
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
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
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

- [ ] **Step 6: Write `firestore.indexes.json`**

```json
{ "indexes": [], "fieldOverrides": [] }
```

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
export const db = getFirestore(app);
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
  GoogleAuthProvider, signInWithPopup, signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, collection, getDocs, query, where, limit, writeBatch,
} from "firebase/firestore";

export const isSupabaseConfigured = isFirebaseConfigured; // name preserved for callers

export async function signInWithGoogle() {
  await signInWithPopup(auth, new GoogleAuthProvider());
}
export async function signOut() { await fbSignOut(auth); }
export function getCurrentUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });
}
export function onAuthChange(cb) { return onAuthStateChanged(auth, cb); }

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

- [ ] **Step 5: Update the OAuth redirect handling in `src/shell/Shell.jsx` and `src/App.jsx`.** `signInWithPopup` needs no redirect callback handling (unlike Supabase's `signInWithOAuth` + URL hash). Remove any post-redirect `getSessionFromUrl`/hash parsing; keep the `onAuthChange`/`getCurrentUser` gate. (Grep `signInWithOAuth`, `INITIAL_SESSION`, `#access_token` — none should remain.)

- [ ] **Step 6: Commit**

```bash
git add src/supabase.js src/authAdapter.test.js src/shell/Shell.jsx src/App.jsx
git commit -m "feat(sp0): Firebase Auth (Google popup) replaces Supabase auth"
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

```js
import { serverTimestamp } from "firebase/firestore";

const stateRef = (uid, name) => doc(db, "users", uid, "state", name);
async function readDoc(ref) {
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data()?.data ?? null) : null;
}
async function writeDoc(ref, dataObj) {
  await setDoc(ref, { data: dataObj, updatedAt: serverTimestamp() }, { merge: true });
}

export const __test = { stateRef, readDoc, writeDoc }; // test-only surface
```

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

- [ ] **Step 3: Rewrite the push body.** Replace each Supabase `upsert(table, {user_id,data})` with `writeDoc(stateRef(userId, name), merged)` and each `fetchCloud(table)` with `readDoc(stateRef(userId, name))`. For objectives loop over `rxt-block-objectives` writing `writeDoc(doc(db,"users",userId,"objectives",blockId), merged)`. For lectures, `writeBatch` over `rxt-lec-meta` writing `doc(db,"users",userId,"lectures",l.id)` with `{ data: lecWithoutChunks, chunks, blockId, termId }`. For KV, loop `KV_KEYS` writing `kv/{key}`. Keep the merge-then-write-back-to-localStorage behavior and the `errors[]` return; drop the `networkDown`/`Failed to fetch` string checks (Firestore throws typed errors — catch and push `{ store, error }`).

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

- [ ] **Step 3: Rewrite MCQ functions.** `saveMcqBankEntry` → `setDoc(doc(db,"users",userId,"mcq",`${objectiveId}__r${round??0}`), { objectiveId, round: round??0, data, updatedAt: serverTimestamp() })` + keep the localStorage cache write. `pushMcqBankToSupabase` → `writeBatch` (chunks of 400, Firestore batch limit is 500) over local bank. `pullMcqBankFromSupabase` → `getDocs(collection(db,"users",userId,"mcq"))`, rebuild `${objectiveId}_r${round}` keys.

- [ ] **Step 4: Rewrite image functions to Firebase Storage.** `uploadQuestionImage` → `uploadBytes(storageRef(storage, `question-images/${userId}/${objectiveId}_r${round??0}/${safeName}`), file)` then `addDoc(collection(db,"users",userId,"questionImages"), {...})`. `fetchQuestionImages` → `getDocs` the collection filtered by objectiveId+round, `getDownloadURL` per file. `deleteQuestionImage` → `deleteObject` + delete the meta doc. (Import `ref as storageRef, uploadBytes, getDownloadURL, deleteObject` from `firebase/storage`; `addDoc, deleteDoc` from `firebase/firestore`.)

- [ ] **Step 5: Swap direct `supabase.from(...)` call-sites in the 6 other files** to Firestore. Add small exported helpers from `supabase.js` for the recognition tables (`saveAnkiCards(uid, cards)`, `getAnkiCards(uid)`, `saveRecognitionItems(uid, items)`, `getRecognitionItems(uid)`, `getUngeneratedCards(uid)`) writing `users/{uid}/ankiCards|recognitionItems|ungeneratedCards`, and replace each file's inline query with a call to the helper. (Grep `supabase.from` across `src/` — zero results after this step.)

- [ ] **Step 6: Run to verify it passes.** Run: `firebase emulators:exec --only auth,firestore,storage "npx vitest run src/firestoreAdapter.test.js"` → Expected: PASS.

- [ ] **Step 7: Verify no Supabase references remain.** Run: `grep -rn "supabase\.\(from\|storage\|auth\)\|@supabase/supabase-js" src/` → Expected: only the (now-unused) import removed; zero call-sites. Remove `@supabase/supabase-js` from `package.json`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(sp0): mcq bank + question images + recognition tables on Firestore"
```

---

## Task 7: Edge Function → Cloud Function (`generateRecognitionItems`)

**Files:**
- Create: `functions/index.js`, `functions/package.json`
- Modify: caller of the edge function (grep `functions/v1/generate-recognition-items` / `supabase.functions.invoke` — in `src/recognitionBank.js` or `src/PatientRecognition.jsx`)
- Reference: `supabase/functions/generate-recognition-items/index.ts` (port its Gemini logic verbatim)

**Interfaces:**
- Produces: an HTTPS **callable** `generateRecognitionItems({ cards, weakSubjects })` returning `{ items }`. Caller uses `httpsCallable(getFunctions(app), "generateRecognitionItems")`.

- [ ] **Step 1: Init functions.** Run: `firebase init functions` (JavaScript, no lint prompt block) — creates `functions/`. Set `GEMINI_API_KEY` via `firebase functions:config:set` or `.env` in `functions/`.

- [ ] **Step 2: Port the handler** — copy the Deno/TS body of `supabase/functions/generate-recognition-items/index.ts` into `functions/index.js` as a callable:

```js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
exports.generateRecognitionItems = onCall(async (req) => {
  const { cards, weakSubjects } = req.data || {};
  if (!req.auth) throw new HttpsError("unauthenticated", "sign in required");
  // ...port the Gemini prompt + fetch + JSON parse from the Deno fn verbatim...
  return { items };
});
```

- [ ] **Step 3: Test against the functions emulator.** Run: `firebase emulators:exec --only functions,auth "npx vitest run src/recognitionGen.test.js"` (write a small test calling the callable with 1 fake card, GEMINI mocked or a fixture) → Expected: PASS returning `{ items: [...] }`.

- [ ] **Step 4: Swap the caller** from `supabase.functions.invoke("generate-recognition-items", {...})` to `httpsCallable(getFunctions(app), "generateRecognitionItems")({ cards, weakSubjects })` and read `.data.items`.

- [ ] **Step 5: Deploy the function.** Run: `firebase deploy --only functions` → Expected: function URL printed, no errors.

- [ ] **Step 6: Commit**

```bash
git add functions src/recognitionBank.js src/PatientRecognition.jsx
git commit -m "feat(sp0): port recognition-item generation to a Cloud Function callable"
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

const sb = createClient(process.env.SB_URL, process.env.SB_SERVICE_KEY);
admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

const SB_UID = process.env.SB_UID;      // Supabase user id (source)
const FB_UID = process.env.FB_UID;      // Firebase uid (target)

const STATE = ["terms","performance","completion","weak_concepts","tracker"];
for (const name of STATE) {
  const { data } = await sb.from(name).select("data").eq("user_id", SB_UID).maybeSingle();
  if (data?.data) await db.doc(`users/${FB_UID}/state/${name}`).set({ data: data.data, updatedAt: new Date() });
}
// objectives (per block)
const { data: objs } = await sb.from("objectives").select("block_id,data").eq("user_id", SB_UID);
for (const o of objs || []) await db.doc(`users/${FB_UID}/objectives/${o.block_id}`).set({ data: o.data, updatedAt: new Date() });
// lectures
const { data: lecs } = await sb.from("lectures").select("lecture_id,block_id,term_id,data,chunks").eq("user_id", SB_UID);
for (const l of lecs || []) await db.doc(`users/${FB_UID}/lectures/${l.lecture_id}`).set({ data: l.data, chunks: l.chunks || [], blockId: l.block_id, termId: l.term_id, updatedAt: new Date() });
// user_kv
const { data: kv } = await sb.from("user_kv").select("key,data").eq("user_id", SB_UID);
for (const r of kv || []) await db.doc(`users/${FB_UID}/kv/${r.key}`).set({ data: r.data, updatedAt: new Date() });
// mcq_bank
const { data: mcq } = await sb.from("mcq_bank").select("objective_id,round,data").eq("user_id", SB_UID);
for (const m of mcq || []) await db.doc(`users/${FB_UID}/mcq/${m.objective_id}__r${m.round ?? 0}`).set({ objectiveId: m.objective_id, round: m.round ?? 0, data: m.data, updatedAt: new Date() });
console.log("migration complete");
```

(question_images: also copy Storage objects — download from Supabase Storage, upload to Firebase Storage, rewrite meta doc paths. Enumerate `question_images` rows and stream each file.)

- [ ] **Step 2: Dry-run count.** Add a `--count` flag that logs row counts per table without writing. Run: `SB_URL=… SB_SERVICE_KEY=… SB_UID=… node scripts/migrate-supabase-to-firestore.mjs --count` → Expected: prints non-zero counts for terms/objectives/lectures matching Louis's Term 1.

- [ ] **Step 3: Run the migration into the emulator first.** Point Admin SDK at the Firestore emulator (`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`) and run; then start the app against the emulator and confirm Term 1 renders (terms, 350 objectives).

- [ ] **Step 4: Run the migration into live Firestore** (Louis-gated, after emulator verify): unset the emulator host, provide real Admin creds, run once. Verify in the Firebase console.

- [ ] **Step 5: Commit the script (no creds).**

```bash
git add scripts/migrate-supabase-to-firestore.mjs
git commit -m "feat(sp0): one-time Supabase→Firestore data migration script"
```

---

## Task 9: Live end-to-end verification (closes the "never run in browser" gap)

**Files:** none (verification task)

- [ ] **Step 1: Configure `.env`** with the real `VITE_FIREBASE_*` values.
- [ ] **Step 2: Enable Google sign-in** in Firebase console (Auth → Sign-in method → Google) and add `localhost` to authorized domains.
- [ ] **Step 3: Build + run.** Run: `npm run build` (Expected: clean) then `npm run dev`.
- [ ] **Step 4: Drive the app in the browser** (use the run/claude-in-chrome flow): load `localhost:5174`, **sign in with Google**, confirm Term 1 data loads (sidebar terms, FTM 2 = 350 objectives), open a block, start an adaptive session, answer an item, confirm the session result **persists** (reload → still there), confirm Patient Recognition pulls from the bank. Read the console for errors — Expected: none.
- [ ] **Step 5: Confirm a fresh write round-trips to Firestore** (make an edit, check the doc appears in the Firebase console).
- [ ] **Step 6: Commit a short verification note** to `docs/superpowers/plans/2026-07-18-sp0-firestore-cutover.md` (check the boxes) and tag the branch.

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
