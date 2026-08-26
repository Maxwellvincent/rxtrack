// Firebase Auth + Firestore + Storage — the sole backend (Task 3: auth
// cutover; Task 4: JSON-doc primitives; Task 5: push/pull/kv; Task 6:
// mcq/images/recognition tables). The Supabase JS client and its stub
// fallback are gone from this module entirely.
import { auth, db, storage, isFirebaseConfigured } from "./firebase";
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut as fbSignOut, onAuthStateChanged,
} from "firebase/auth";
import {
  doc, getDoc, deleteDoc, collection, getDocs, query, where, orderBy, limit,
  setDoc, runTransaction, writeBatch, serverTimestamp,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { encodeDocId, decodeDocId } from "./idCodec";
import { storeForKey } from "./stores/index.js";
import { applyLocalCap, SKIP_ON_PULL } from "./stores/capped.js";
import { createSessionShape, sessionBytes, MAX_EXAM_SESSION_BYTES } from "./examSessions.js";

// SP1 T0.3: shared-data keys are owned by src/stores/*. Values reaching here are
// ALREADY merged by this module's own merge fns — whose argument order differs
// from the stores' conflict policies — so this is an authoritative replace, not
// a store merge(). userId stays null: the app writes non-namespaced keys today
// and namespacing lands with the hooks in T0.4 (docs/sp1/T0.3-spec.md §4).
function persistLocal(key, value) {
  const store = storeForKey(key);
  if (store) store.write(null, value);
  else localStorage.setItem(key, JSON.stringify(value));
}

// Auth (and data) gate on Firebase config — name preserved for callers that
// still check it before showing cloud-dependent UI.
export const isSupabaseConfigured = isFirebaseConfigured;

// ─── AUTH (Firebase) ─────────────────────────────────

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
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Redirect fallback covers: popup blocked, third-party cookie restrictions
    // (auth/web-storage-unavailable), and unsupported environments
    const redirectCodes = [
      "auth/popup-blocked",
      "auth/popup-closed-by-user",
      "auth/cancelled-popup-request",
      "auth/web-storage-unavailable",
      "auth/operation-not-supported-in-this-environment",
    ];
    if (redirectCodes.includes(e?.code)) {
      await signInWithRedirect(auth, provider);
    } else throw e;
  }
}

export async function signOut() {
  await fbSignOut(auth);
}

export function getCurrentUser() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(normalize(u)); });
  });
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, (u) => cb(normalize(u)));
}

// Complete a pending redirect sign-in on boot (findings 3,4).
export async function completeRedirectSignIn() {
  try { const res = await getRedirectResult(auth); return normalize(res?.user ?? null); }
  catch { return null; }
}

/** True if cloud has a terms doc or any objectives doc (matches pull “has data” semantics). */
export async function checkCloudHasData(userId) {
  if (!userId) return false;
  try {
    const termsSnap = await getDoc(doc(db, "users", userId, "state", "terms"));
    if (termsSnap.exists() && termsSnap.data()?.data) return true;
    const objSnap = await getDocs(query(collection(db, "users", userId, "objectives"), limit(1)));
    return !objSnap.empty;
  } catch {
    return false;
  }
}

// ─── FIRESTORE JSON-DOC PRIMITIVES (Task 4) ─────────────────────────────
// Every per-user state store (terms, objectives index, etc.) is a single
// JSON blob under users/{uid}/state/{name}. These primitives are the only
// way Tasks 5-6 touch that shape.
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

// The remote shell flag (kv/rxt-shell-flag) and its rollback helpers lived here
// through SP1 T5.1. They rolled a device back to App.jsx, which no longer
// exists, so there is nothing left to roll back to. The stale flag documents are
// harmless — nothing reads them.

/**
 * Lecture ids App has deleted or replaced locally (`rxt-id-tombstones`).
 *
 * App has written this list since forever; nothing ever read it on the sync
 * side, which is why a re-uploaded lecture came back: the local row was
 * replaced, but its cloud doc survived and the next pull re-added it.
 */
export function readLectureTombstoneIds() {
  try {
    const list = JSON.parse(localStorage.getItem("rxt-id-tombstones") || "[]");
    return new Set((Array.isArray(list) ? list : []).map((t) => t?.oldId).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Delete a lecture's cloud doc. The one exception to "lectures are never deleted". */
export async function deleteLectureFromCloud(userId, lecId) {
  if (!userId || !lecId) return false;
  await deleteDoc(doc(db, "users", userId, "lectures", encodeDocId(lecId)));
  return true;
}

/**
 * Lecture content on demand.
 *
 * `pullAllDataFromSupabase` hydrates `chunks` into localStorage for the active
 * term ONLY — everything older stays chunk-light so the ~5MB quota survives.
 * Which means 363 of 367 lectures have no text locally, and anything that wants
 * to read a lecture (extraction, quiz grounding) has to come here for it.
 *
 * @returns {Promise<{chunks: object[], atoms: object[], meta: object}|null>}
 */
export async function fetchLectureContent(userId, lecId) {
  if (!userId || !lecId) return null;
  const snap = await getDoc(doc(db, "users", userId, "lectures", encodeDocId(lecId)));
  if (!snap.exists()) return null;
  const v = snap.data() || {};
  return { chunks: v.chunks || [], atoms: v.atoms || [], images: v.images || [], meta: v.data || {} };
}

/**
 * Write one lecture's doc, chunks included.
 *
 * The bulk importer needs this: pushing everything through
 * `pushAllLocalDataToSupabase` would mean keeping every lecture's text in
 * localStorage first, and 120 decks of it does not fit in the ~5MB quota. So the
 * text goes straight to Firestore and only a chunk-light row stays local, which
 * is the same split a pull produces for non-active terms.
 */
export async function saveLectureToCloud(userId, lecture) {
  if (!userId || !lecture?.id) return { saved: false, reason: "no user or lecture id" };
  const { chunks, fullText, ...rest } = lecture;
  // OCR records often carry the same lecture twice: page chunks plus one
  // concatenated fullText field. Persisting both can cross Firestore's 1 MB
  // document limit and make a perfectly extracted deck appear to save while
  // nothing reaches the cloud. Chunks are the canonical body when present.
  if ((!chunks || !chunks.length) && fullText) rest.fullText = fullText;
  // Firestore rejects undefined outright, and one bad field kills the write.
  const meta = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  const payload = {
    data: meta,
    blockId: lecture.blockId ?? null,
    termId: lecture.termId ?? null,
    updatedAt: serverTimestamp(),
  };
  if (chunks && chunks.length) payload.chunks = chunks;
  if (JSON.stringify(payload).length > MAX_DOC_BYTES) {
    return { saved: false, reason: "oversized" };
  }
  await setDoc(doc(db, "users", userId, "lectures", encodeDocId(lecture.id)), payload, { merge: true });
  return { saved: true };
}

/**
 * Store extracted atoms on the lecture doc. They live in Firestore rather than
 * localStorage on purpose: 40 atoms across 367 lectures would be ~1.8MB of a
 * budget that just had 794KB clawed back out of it.
 */
export async function saveLectureAtoms(userId, lecId, atoms) {
  if (!userId || !lecId) return { saved: 0 };
  const list = Array.isArray(atoms) ? atoms : [];
  await setDoc(
    doc(db, "users", userId, "lectures", encodeDocId(lecId)),
    { atoms: list, atomsUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  return { saved: list.length };
}

/**
 * Store a lecture's labelled figures.
 *
 * Labels only — each entry is `{ file, url, kind, shows, context }` and the JPEG itself lives in
 * Firebase Storage. Binaries can never go here: a Firestore doc caps at 1MB and one lecture
 * carries fifty photomicrographs.
 */
export async function saveLectureImages(userId, lecId, images) {
  if (!userId || !lecId) return { saved: 0 };
  const list = Array.isArray(images) ? images : [];
  await setDoc(
    doc(db, "users", userId, "lectures", encodeDocId(lecId)),
    { images: list, imagesUpdatedAt: serverTimestamp() },
    { merge: true }
  );
  return { saved: list.length };
}

/**
 * Authoritative rewrite of the objectives collection — the ONE place that is
 * allowed to shrink cloud data.
 *
 * Every other push is read-merge-write, which is what keeps two devices from
 * deleting each other's work. Compaction needs the opposite: `{ merge: false }`
 * so the stripped fields actually leave the cloud doc, and a real delete for a
 * block that is a dead duplicate. Callers must have confirmed the deletion.
 *
 * @returns {Promise<{written: number, deleted: number, errors: object[]}>}
 */
export async function overwriteObjectivesInCloud(userId, store, deletedBlockIds = []) {
  if (!userId) return { written: 0, deleted: 0, errors: [{ message: "no userId" }] };
  const errors = [];
  let written = 0;
  let deleted = 0;

  for (const [blockId, entry] of Object.entries(store || {})) {
    try {
      await setDoc(
        doc(db, "users", userId, "objectives", encodeDocId(blockId)),
        { data: entry, updatedAt: serverTimestamp() },
        { merge: false }
      );
      written += 1;
    } catch (e) {
      errors.push({ block: blockId, message: e?.message || String(e) });
    }
  }

  // Copy before delete: the block lands in `objectivesBackup` so a wrong call is
  // recoverable without a restore from a device that still has the data.
  for (const blockId of deletedBlockIds) {
    try {
      const ref = doc(db, "users", userId, "objectives", encodeDocId(blockId));
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await setDoc(
          doc(db, "users", userId, "objectivesBackup", encodeDocId(blockId)),
          { ...snap.data(), backedUpAt: serverTimestamp() },
          { merge: false }
        );
      }
      await deleteDoc(ref);
      deleted += 1;
    } catch (e) {
      errors.push({ block: blockId, message: e?.message || String(e) });
    }
  }

  return { written, deleted, errors };
}

// ─── MERGE HELPERS ───────────────────────────────────
// Every push is read-merge-write: fetch cloud first, merge local ON TOP additively,
// then write back. Cloud data is never silently deleted or overwritten.

/** Dedup sessions within 90s of each other (same type + lecture = same session). */
function mergeSessions(cloud = [], local = []) {
  const all = [...(cloud || []), ...(local || [])];
  const seen = new Set();
  return all
    .filter((s) => {
      const bucket = Math.floor(new Date(s.date || s.startedAt || 0).getTime() / 90000);
      const key = `${s.sessionType || ""}__${s.lectureId || s.topicKey || ""}__${bucket}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(a.date || a.startedAt || 0) - new Date(b.date || b.startedAt || 0));
}

/** Merge rxt-performance: union sessions per lecture key, never lose entries. */
function mergePerformance(cloud = {}, local = {}) {
  const result = { ...(cloud || {}) };
  for (const [key, localEntry] of Object.entries(local || {})) {
    if (!result[key]) {
      result[key] = localEntry;
    } else {
      const mergedSessions = mergeSessions(result[key].sessions, localEntry.sessions);
      const scores = mergedSessions.map((s) => s.score).filter((s) => typeof s === "number");
      result[key] = {
        ...result[key],
        ...localEntry,
        sessions: mergedSessions.slice(-50),
        score: scores.length
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : result[key].score ?? localEntry.score,
      };
    }
  }
  return result;
}

/** Merge rxt-completion: take max completionLevel; trust the newer side's reviewDates
 *  (since reviewDates is recomputed from the latest activity each time, unioning re-introduces
 *  dates the user already cleared by reviewing locally). activityLog is unioned by id. */
function mergeCompletion(cloud = {}, local = {}) {
  const result = { ...(cloud || {}) };
  for (const [key, localEntry] of Object.entries(local || {})) {
    if (!result[key]) {
      result[key] = localEntry;
    } else {
      const cloudEntry = result[key];
      const cloudTs = cloudEntry.lastActivityDate ? new Date(cloudEntry.lastActivityDate).getTime() : 0;
      const localTs = localEntry.lastActivityDate ? new Date(localEntry.lastActivityDate).getTime() : 0;
      const newer = localTs >= cloudTs ? localEntry : cloudEntry;
      // Union activityLog by id; sort newest first.
      const aLog = Array.isArray(cloudEntry.activityLog) ? cloudEntry.activityLog : [];
      const bLog = Array.isArray(localEntry.activityLog) ? localEntry.activityLog : [];
      const logMap = new Map();
      [...aLog, ...bLog].forEach((e) => {
        if (!e) return;
        const id = e.id || `${e.date || ""}|${e.activityType || ""}|${e.confidenceRating || ""}`;
        const existingLog = logMap.get(id);
        if (!existingLog || new Date(e.date || 0) >= new Date(existingLog.date || 0)) {
          logMap.set(id, e);
        }
      });
      const mergedLog = Array.from(logMap.values()).sort(
        (x, y) => new Date(y.date || 0) - new Date(x.date || 0)
      );
      result[key] = {
        ...cloudEntry,
        ...localEntry,
        completionLevel: Math.max(cloudEntry.completionLevel || 0, localEntry.completionLevel || 0),
        reviewDates: Array.isArray(newer.reviewDates)
          ? newer.reviewDates
          : (cloudEntry.reviewDates || localEntry.reviewDates || []),
        lastActivityDate: newer.lastActivityDate || cloudEntry.lastActivityDate || localEntry.lastActivityDate,
        lastConfidence: newer.lastConfidence || cloudEntry.lastConfidence || localEntry.lastConfidence,
        firstCompletedDate:
          cloudEntry.firstCompletedDate || localEntry.firstCompletedDate || newer.firstCompletedDate,
        activityLog: mergedLog,
      };
    }
  }
  return result;
}

/** Merge objectives for a single block: union by id, trust the entry with more drill evidence. */
function mergeBlockObjectives(cloud, local) {
  if (!cloud) return local;
  if (!local) return cloud;
  const cloudById = {};
  (cloud.imported || []).forEach((o) => { if (o.id) cloudById[o.id] = o; });
  const localById = {};
  (local.imported || []).forEach((o) => { if (o.id) localById[o.id] = o; });
  const allIds = new Set([...Object.keys(cloudById), ...Object.keys(localById)]);
  const merged = [];
  for (const id of allIds) {
    const c = cloudById[id];
    const l = localById[id];
    if (!c) { merged.push(l); continue; }
    if (!l) { merged.push(c); continue; }
    const cDrills = c.drillCount || 0;
    const lDrills = l.drillCount || 0;
    // Prefer whichever has more drill evidence; ties go to local (more recent)
    merged.push(lDrills >= cDrills ? { ...c, ...l } : { ...l, ...c });
  }
  // Union extracted arrays too
  const extractedIds = new Set([...(cloud.extracted || []).map((e) => e.id || e), ...(local.extracted || []).map((e) => e.id || e)]);
  const allExtracted = [...(cloud.extracted || []), ...(local.extracted || [])].filter((e) => {
    const id = e.id || e;
    if (!extractedIds.has(id)) return false;
    extractedIds.delete(id);
    return true;
  });
  return { ...cloud, ...local, imported: merged, extracted: allExtracted };
}

/** Merge rxt-weak-concepts: union concepts per block by id, keep highest missCount. */
function mergeWeakConcepts(cloud = {}, local = {}) {
  const result = {};
  const allBlocks = new Set([...Object.keys(cloud || {}), ...Object.keys(local || {})]);
  for (const blockId of allBlocks) {
    const byId = {};
    [...(cloud[blockId] || []), ...(local[blockId] || [])].forEach((c) => {
      if (!c.id) return;
      if (!byId[c.id] || (c.missCount || 0) > (byId[c.id].missCount || 0)) byId[c.id] = c;
    });
    result[blockId] = Object.values(byId);
  }
  return result;
}

/** Merge rxt-terms: union term/block arrays by id. */
function mergeTerms(cloud, local) {
  if (!cloud) return local;
  if (!local) return cloud;
  if (!Array.isArray(cloud) || !Array.isArray(local)) return local ?? cloud;
  const byId = {};
  [...cloud, ...local].forEach((t) => {
    if (!t.id) return;
    if (!byId[t.id]) { byId[t.id] = t; return; }
    const existingBlocks = byId[t.id].blocks || [];
    const newBlocks = t.blocks || [];
    const blockIds = new Set(existingBlocks.map((b) => b.id));
    byId[t.id] = {
      ...byId[t.id],
      ...t,
      blocks: [...existingBlocks, ...newBlocks.filter((b) => !blockIds.has(b.id))],
    };
  });
  return Object.values(byId);
}

/** Generic additive merge for user_kv values: arrays → union, objects → deep merge, primitives → local wins. */
function mergeKvValue(cloud, local) {
  if (cloud == null) return local;
  if (local == null) return cloud;
  if (Array.isArray(cloud) && Array.isArray(local)) {
    // Try to union by id; fall back to concat+dedup by JSON fingerprint
    const hasIds = local.every((x) => x && typeof x === "object" && x.id);
    if (hasIds) {
      const cloudById = {};
      cloud.forEach((x) => { if (x?.id) cloudById[x.id] = x; });
      const result = [...cloud];
      local.forEach((x) => {
        if (!x?.id || cloudById[x.id]) return; // already in cloud
        result.push(x);
      });
      return result;
    }
    // No ids — union by JSON fingerprint
    const seen = new Set(cloud.map((x) => JSON.stringify(x)));
    return [...cloud, ...local.filter((x) => !seen.has(JSON.stringify(x)))];
  }
  if (typeof cloud === "object" && typeof local === "object") {
    const result = { ...cloud };
    for (const [k, v] of Object.entries(local)) {
      result[k] = k in result ? mergeKvValue(result[k], v) : v;
    }
    return result;
  }
  return local; // primitives: local (most recent) wins
}

// ─── PUSH LOCAL DATA TO SUPABASE ─────────────────────

// rxt-question-banks is absent deliberately: it is a Firestore-first store now
// (stores/questionBanks.js) and owns its own kv document. Leaving it here would
// merge the local leftovers back in on every push, walking a removed bank
// straight back — the same read-merge-write trap the objectives hit.
const KV_KEYS = [
  "rxt-exam-results",
  "rxt-exam-dates",
  "rxt-study-routine",
  "rxt-miss-notes",
  "rxt-weak-drills",
  "rxt-learning-profile",
  "rxt-sessions",
  "rxt-analyses",
  "rxt-weak-areas",
  "rxt-dl-sessions",
  "rxt-missed-questions",
  "rxt-supplemental-resources",
  "rxt-reviewed-lecs",
  "rxt-style-prefs",
  "rxt-question-notes",
  "rxt-calibration-log",
  "rxt-assessments",
];

// Byte-guard: Firestore doc limit is 1MB; skip (log+shard-later) anything
// that would trip it rather than silently truncating or crashing (R4-6).
const MAX_DOC_BYTES = 900_000;

export async function pushAllLocalDataToSupabase(userId) {
  if (!userId) return [];
  console.log("Starting merge-push for user:", userId);
  const errors = [];

  // ── 1-5. STATE STORES (transactional merge, write merged back to localStorage) ──
  for (const [lsKey, name, mergeFn] of [
    ["rxt-terms", "terms", mergeTerms],
    ["rxt-performance", "performance", mergePerformance],
    ["rxt-completion", "completion", mergeCompletion],
    ["rxt-weak-concepts", "weak_concepts", mergeWeakConcepts],
    ["rxt-tracker-v2", "tracker", mergeKvValue],
  ]) {
    const raw = localStorage.getItem(lsKey);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (JSON.stringify(parsed).length > MAX_DOC_BYTES) {
        errors.push({ store: name, error: { message: "oversized, skipped" } });
        continue;
      }
      const merged = await mergeDoc(stateRef(userId, name), parsed, mergeFn);
      // The cloud doc keeps the whole thing; the device keeps the working set.
      persistLocal(lsKey, applyLocalCap(lsKey, merged));
    } catch (e) {
      errors.push({ store: name, error: { message: e?.message || String(e) } });
    }
  }

  // ── 6. OBJECTIVES (merge per block, encoded ids) ──────────────────
  const objStore = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
  for (const [blockId, local] of Object.entries(objStore)) {
    try {
      if (JSON.stringify(local).length > MAX_DOC_BYTES) {
        errors.push({ store: `objectives:${blockId}`, error: { message: "oversized, skipped" } });
        continue;
      }
      const merged = await mergeDoc(
        doc(db, "users", userId, "objectives", encodeDocId(blockId)),
        local,
        mergeBlockObjectives
      );
      objStore[blockId] = merged;
    } catch (e) {
      errors.push({ store: `objectives:${blockId}`, error: { message: e?.message || String(e) } });
    }
  }
  try { persistLocal("rxt-block-objectives", objStore); } catch {}

  // ── 7. LECTURES (chunked batch, encoded ids) ──────────────────
  // Tombstoned ids are the ONE thing that gets deleted up here: without this a
  // locally-replaced lecture is resurrected by the next pull, and re-uploading
  // a lecture leaves a permanent duplicate behind.
  const lecs = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
  const tombstoned = readLectureTombstoneIds();
  const liveIds = new Set(lecs.map((l) => l?.id));
  for (const deadId of tombstoned) {
    if (liveIds.has(deadId)) continue; // re-created since; leave it alone
    try {
      await deleteLectureFromCloud(userId, deadId);
    } catch (e) {
      errors.push({ store: `lectures:${deadId}`, error: { message: e?.message || String(e) } });
    }
  }

  const lecOps = [];
  for (const l of lecs) {
    const { chunks, ...rest } = l;
    // Firestore rejects `undefined` outright — one lecture carrying an undefined
    // field (termId, in practice) aborts the whole batch and silently kills the
    // push. Drop them; an absent field reads back the same as an undefined one.
    const meta = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const payload = { data: meta, blockId: l.blockId ?? null, termId: l.termId ?? null };
    // Only write chunks when we actually hold them. Omitting the field lets
    // Firestore's merge PRESERVE the existing cloud chunks — so lectures we
    // keep chunk-light in localStorage (older terms) don't get wiped on sync.
    if (chunks && chunks.length) payload.chunks = chunks;
    if (JSON.stringify(payload).length > MAX_DOC_BYTES) {
      errors.push({ store: `lectures:${l.id}`, error: { message: "oversized, skipped" } });
      continue;
    }
    lecOps.push((b) =>
      b.set(
        doc(db, "users", userId, "lectures", encodeDocId(l.id)),
        { ...payload, updatedAt: serverTimestamp() },
        { merge: true }
      )
    );
  }
  await commitInChunks(lecOps, errors);

  // ── 8. USER_KV (all remaining keys, encoded ids) ───────────────────
  for (const key of KV_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (JSON.stringify(parsed).length > MAX_DOC_BYTES) {
        errors.push({ store: `kv:${key}`, error: { message: "oversized, skipped" } });
        continue;
      }
      // DeepLearn sessions go to their own collection: together they crossed
      // the doc guard, so this key was skipped on every push and the sessions
      // had no cloud copy at all.
      if (key === "rxt-dl-sessions") {
        const { errors: dlErrors } = await pushDeepLearnSessions(userId, parsed);
        dlErrors.forEach((e) => errors.push({ store: `dlSessions:${e.session || "?"}`, error: { message: e.message } }));
        continue;
      }
      const merged = await mergeDoc(doc(db, "users", userId, "kv", encodeDocId(key)), parsed, mergeKvValue);
      // The cloud doc keeps the whole history; localStorage keeps a working set
      // for the capped keys. Without this, every generated MCQ and every missed
      // question is mirrored back on every sync and the ~5MB budget goes to
      // history instead of to the lectures and objectives that need it.
      persistLocal(key, applyLocalCap(key, merged));
    } catch (e) {
      errors.push({ store: `kv:${key}`, error: { message: e?.message || String(e) } });
    }
  }

  // ── 9. MCQ BANK (awaited — folds its errors into the returned errors[], R2-finding 13) ──
  try {
    const mcqErrors = await pushMcqBankToSupabase(userId);
    if (Array.isArray(mcqErrors)) errors.push(...mcqErrors);
  } catch (e) {
    errors.push({ store: "mcq", error: { message: e?.message || String(e) } });
  }

  if (errors.length > 0) {
    console.warn(`Push completed with ${errors.length} error(s):`, errors);
  } else {
    console.log("Merge-push complete — all data additive, nothing overwritten");
  }

  return errors;
}

// ─── PULL SUPABASE DATA TO LOCAL ─────────────────────

export async function pullAllDataFromSupabase(userId) {
  if (!userId) return {};

  console.log("Pulling data for user:", userId);

  // Read all 5 state docs up front so we can decide "empty" only when ALL
  // canonical stores are absent — objectives/lectures/kv must still pull
  // even if e.g. state/terms is missing (independent-pull requirement).
  const [terms, perf, comp, weak, tracker] = await Promise.all([
    readDoc(stateRef(userId, "terms")),
    readDoc(stateRef(userId, "performance")),
    readDoc(stateRef(userId, "completion")),
    readDoc(stateRef(userId, "weak_concepts")),
    readDoc(stateRef(userId, "tracker")),
  ]);

  const objsSnap = await getDocs(collection(db, "users", userId, "objectives"));
  const lecsSnap = await getDocs(collection(db, "users", userId, "lectures"));
  // kv is a canonical store too (e.g. rxt-question-notes, rxt-calibration-log) —
  // a kv-only account must not hit the empty-return below. Cheap presence check.
  const kvSnap = await getDocs(query(collection(db, "users", userId, "kv"), limit(1)));

  if (
    terms == null && perf == null && comp == null && weak == null && tracker == null &&
    objsSnap.empty && lecsSnap.empty && kvSnap.empty
  ) {
    console.log("No cloud data found — skipping pull");
    return { empty: true };
  }

  // Terms: merge cloud into local (union blocks)
  if (terms != null) {
    const localTermsRaw = localStorage.getItem("rxt-terms");
    const mergedTerms = mergeTerms(localTermsRaw ? JSON.parse(localTermsRaw) : null, terms);
    persistLocal("rxt-terms", mergedTerms);
  }

  // Lectures: cloud adds to local, local stubs preserved.
  // Heavy per-page `chunks` are hydrated into localStorage ONLY for the active
  // (most recent) term — older terms stay chunk-light so localStorage doesn't
  // blow the ~5MB quota. Their chunks live in Firestore, fetched on demand.
  if (!lecsSnap.empty) {
    const termsArr = (() => { try { return JSON.parse(localStorage.getItem("rxt-terms") || "[]"); } catch { return []; } })();
    const activeTerm = termsArr[termsArr.length - 1];
    const activeBlockIds = new Set((activeTerm?.blocks || []).map((b) => b.id));
    // Belt and braces with the tombstone deletes on push: a doc this device
    // already buried must not walk back in from a stale cloud copy.
    const buried = readLectureTombstoneIds();
    const fromCloud = lecsSnap.docs.filter((d) => !buried.has(decodeDocId(d.id))).map((d) => {
      const v = d.data();
      const lec = { ...(v.data || {}), id: decodeDocId(d.id) };
      lec.chunks = activeBlockIds.has(lec.blockId) ? (v.chunks || []) : [];
      return lec;
    });
    const local = JSON.parse(localStorage.getItem("rxt-lec-meta") || "[]");
    const cloudIds = new Set(fromCloud.map((l) => l.id));
    const localOnly = local.filter((l) => !cloudIds.has(l.id));
    persistLocal("rxt-lec-meta", [...fromCloud, ...localOnly]);
  }

  // Objectives: merge per block using same merge function as push
  if (!objsSnap.empty) {
    const local = JSON.parse(localStorage.getItem("rxt-block-objectives") || "{}");
    const objMap = { ...local };
    objsSnap.docs.forEach((d) => {
      const blockId = decodeDocId(d.id);
      objMap[blockId] = mergeBlockObjectives(local[blockId] ?? null, d.data()?.data ?? null);
    });
    persistLocal("rxt-block-objectives", objMap);
  }

  // Performance: merge sessions — never lose local sessions
  if (perf != null) {
    const localPerf = localStorage.getItem("rxt-performance");
    const merged = mergePerformance(perf, localPerf ? JSON.parse(localPerf) : {});
    persistLocal("rxt-performance", merged);
  }

  // Completion: merge, take max completionLevel
  if (comp != null) {
    const localComp = localStorage.getItem("rxt-completion");
    const merged = mergeCompletion(comp, localComp ? JSON.parse(localComp) : {});
    persistLocal("rxt-completion", merged);
  }

  // Weak concepts: union, then trimmed — the source questions and lecture
  // labels each concept drags along are most of its size, and restoring them in
  // full is what put 696KB straight back after every reload.
  if (weak != null) {
    const localWeak = localStorage.getItem("rxt-weak-concepts");
    const merged = mergeWeakConcepts(weak, localWeak ? JSON.parse(localWeak) : {});
    persistLocal("rxt-weak-concepts", applyLocalCap("rxt-weak-concepts", merged));
  }

  // Tracker: additive merge
  if (tracker != null) {
    const localTracker = localStorage.getItem("rxt-tracker-v2");
    const merged = mergeKvValue(tracker, localTracker ? JSON.parse(localTracker) : null);
    persistLocal("rxt-tracker-v2", merged);
  }

  // Pull user_kv in background — non-blocking
  pullUserKvFromSupabase(userId).catch(() => {});

  // Pull MCQ bank in background — non-blocking
  pullMcqBankFromSupabase(userId).catch(() => {});

  console.log("Pull complete");
  return true;
}

/**
 * Pull all kv docs from Firestore into localStorage.
 * Called once on sign-in alongside pullAllDataFromSupabase.
 */
export async function pullUserKvFromSupabase(userId) {
  if (!userId) return;
  try {
    const snap = await getDocs(collection(db, "users", userId, "kv"));
    if (snap.empty) return;
    let count = 0;
    snap.docs.forEach((d) => {
      const val = d.data()?.data;
      if (val == null) return;
      const key = decodeDocId(d.id);
      if (SKIP_ON_PULL.has(key)) return; // lives in its own collection now
      try {
        // Same cap on the way in: a pull must not restore the whole history
        // that the push just declined to mirror.
        persistLocal(key, applyLocalCap(key, val));
        count++;
      } catch (e) {
        console.warn("user_kv restore failed for", key, e?.message);
      }
    });
    console.log(`user_kv: pulled ${count} keys from Firestore`);
  } catch (e) {
    console.warn("user_kv pull exception:", e?.message);
  }
}

// ─── MCQ BANK ─────────────────────────────────────────

/**
 * Upsert a single question into Firestore users/{uid}/mcq/{objectiveId}__r{round}.
 * Also writes to localStorage as a fast local cache.
 */
export async function saveMcqBankEntry(userId, objectiveId, round, data) {
  if (!userId || !objectiveId) return;
  // Always keep localStorage in sync as the fast read cache
  try {
    const bank = JSON.parse(localStorage.getItem("rxt-mcq-bank") || "{}");
    bank[`${objectiveId}_r${round ?? 0}`] = { ...data, _savedAt: Date.now() };
    persistLocal("rxt-mcq-bank", bank);
  } catch { /* storage full — ignore */ }

  try {
    const ref = doc(db, "users", userId, "mcq", `${encodeDocId(objectiveId)}__r${round ?? 0}`);
    await setDoc(ref, { objectiveId, round: round ?? 0, data, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.warn("mcq save failed:", e?.message);
  }
}

/**
 * DeepLearn sessions, one Firestore doc each.
 *
 * They used to ride along in the single `kv` doc for rxt-dl-sessions, and that
 * map crossed the 900KB guard — so the push skipped it every time and the only
 * copy of a paused session was the one in localStorage. A single session
 * carrying its generated SAQs is 844KB on its own, so the map was only ever
 * going to grow past the limit; per-session docs give each one its own budget.
 */
export async function pushDeepLearnSessions(userId, sessions) {
  if (!userId) return { written: 0, errors: [{ message: "no userId" }] };
  const map = sessions || {};
  const errors = [];
  let written = 0;

  for (const [sessionId, payload] of Object.entries(map)) {
    try {
      if (JSON.stringify(payload).length > MAX_DOC_BYTES) {
        errors.push({ session: sessionId, message: "single session oversized, skipped" });
        continue;
      }
      await setDoc(
        doc(db, "users", userId, "dlSessions", encodeDocId(sessionId)),
        { data: payload, updatedAt: serverTimestamp() },
        { merge: false }
      );
      written += 1;
    } catch (e) {
      errors.push({ session: sessionId, message: e?.message || String(e) });
    }
  }
  return { written, errors };
}

/** One session's full payload, for resuming a session whose body is not local. */
export async function fetchDeepLearnSession(userId, sessionId) {
  if (!userId || !sessionId) return null;
  const snap = await getDoc(doc(db, "users", userId, "dlSessions", encodeDocId(sessionId)));
  return snap.exists() ? snap.data()?.data ?? null : null;
}

/** Every stored session, keyed as DeepLearn expects. */
export async function fetchAllDeepLearnSessions(userId) {
  if (!userId) return {};
  const snap = await getDocs(collection(db, "users", userId, "dlSessions"));
  const out = {};
  snap.docs.forEach((d) => { out[decodeDocId(d.id)] = d.data()?.data; });
  return out;
}

// ─── EXAM SESSIONS ───────────────────────────────────────────────────────
// Block-wide timed mini-exam (or practice) sessions, one Firestore doc each
// under users/{uid}/examSessions/{sessionId}. Unlike dlSessions and the
// state/mcq docs, the whole session schema (src/examSessions.js) IS the top-
// level document body — no `{data: ...}` wrapper — because a later dashboard
// task needs to query top-level `blockId` and `status` together.
const examSessionRef = (userId, sessionId) =>
  doc(db, "users", userId, "examSessions", encodeDocId(sessionId));

/**
 * Persist a brand-new (or fully-replaced) exam session. Callers await this
 * and see real failures — unlike writeCloud's fire-and-forget shape, there's
 * no catch-and-console.warn here.
 */
export async function createExamSession(userId, session) {
  if (sessionBytes(session) > MAX_EXAM_SESSION_BYTES) {
    return { ok: false, error: "session too large" };
  }
  await setDoc(examSessionRef(userId, session.sessionId), session);
  return { ok: true };
}

/** Fetch one exam session's full document, or null if it doesn't exist. */
export async function getExamSession(userId, sessionId) {
  if (!userId || !sessionId) return null;
  const snap = await getDoc(examSessionRef(userId, sessionId));
  return snap.exists() ? snap.data() : null;
}

/** List exam sessions for a block, optionally filtered further by status. */
export async function listExamSessions(userId, blockId, { status } = {}) {
  const constraints = [where("blockId", "==", blockId)];
  if (status) constraints.push(where("status", "==", status));
  const snap = await getDocs(
    query(collection(db, "users", userId, "examSessions"), ...constraints)
  );
  return snap.docs.map((d) => d.data());
}

/**
 * Generic CAS transactional primitive: read the current session (or null),
 * hand it to the caller-supplied `updateFn`, and write back whatever it
 * returns with `rev` incremented and `updatedAt` refreshed. `updateFn` can
 * veto the write entirely by returning null, in which case the doc is left
 * unchanged and the current value is returned.
 *
 * Task 2 does not implement any `updateFn` — later tasks provide their own
 * precondition/merge logic (e.g. "only proceed if status === in_progress",
 * or "merge this one answer via mergeAnswer").
 */
export async function updateExamSessionTransaction(userId, sessionId, updateFn) {
  const ref = examSessionRef(userId, sessionId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data() : null;
    const next = updateFn(current);
    if (next === null) return current;
    const withMeta = { ...next, rev: (current?.rev ?? 0) + 1, updatedAt: serverTimestamp() };
    tx.set(ref, withMeta);
    return withMeta;
  });
}

/**
 * Pull all mcq docs for this user from Firestore into localStorage.
 * Called once on sign-in alongside pullAllDataFromSupabase.
 */
export async function pullMcqBankFromSupabase(userId) {
  if (!userId) return;
  try {
    const snap = await getDocs(collection(db, "users", userId, "mcq"));
    if (snap.empty) return;
    const bank = {};
    snap.docs.forEach((d) => {
      const v = d.data();
      // Rebuild the local cache key from the doc's own fields, not the encoded doc id.
      bank[`${v.objectiveId}_r${v.round ?? 0}`] = v.data;
    });
    // Every question ever generated lives in the `mcq` collection; the local
    // cache keeps a working set so it cannot grow past the storage budget.
    persistLocal("rxt-mcq-bank", applyLocalCap("rxt-mcq-bank", bank));
    console.log(`mcq: pulled ${snap.docs.length} questions from Firestore, kept the most recent locally`);
  } catch (e) {
    console.warn("mcq pull exception:", e?.message);
  }
}

/**
 * Push the entire local mcq_bank to Firestore.
 * Used in the full data push cycle. Returns an errors[] array (folded into
 * pushAllLocalDataToSupabase's return, R2-finding 13 — no fire-and-forget).
 */
export async function pushMcqBankToSupabase(userId) {
  const errors = [];
  if (!userId) return errors;
  try {
    const bank = JSON.parse(localStorage.getItem("rxt-mcq-bank") || "{}");
    const entries = Object.entries(bank);
    if (!entries.length) return errors;
    const ops = entries.map(([key, data]) => {
      const [objId, roundStr] = key.split("_r");
      const round = parseInt(roundStr ?? "0", 10) || 0;
      const ref = doc(db, "users", userId, "mcq", `${encodeDocId(objId)}__r${round}`);
      return (b) => b.set(ref, { objectiveId: objId, round, data, updatedAt: serverTimestamp() }, { merge: true });
    });
    await commitInChunks(ops, errors);
    console.log(`mcq: pushed ${ops.length - errors.length} questions to Firestore`);
  } catch (e) {
    errors.push({ store: "mcq", error: { message: e?.message || String(e) } });
  }
  return errors;
}

/**
 * Upload a lecture's usable figures and return the entries to store on the lecture.
 *
 * `manifest` is the `images.json` written by `scripts/label-lecture-images.mjs`; `files` are the
 * JPEGs from the same folder, keyed by filename. Decorative entries are dropped here rather
 * than at label time so a re-classification never needs a re-upload.
 *
 * One failed upload skips that figure instead of failing the lecture — a study round with
 * nineteen images is not worth losing over the twentieth.
 */
export async function uploadLectureImages(userId, lecId, manifest, files, onProgress) {
  if (!userId || !lecId) return [];
  const usable = (manifest || []).filter((m) => m && m.kind && m.kind !== "decorative");
  const out = [];
  for (let i = 0; i < usable.length; i++) {
    const m = usable[i];
    const file = files?.get?.(m.file) || files?.[m.file];
    if (!file) continue;
    const path = `lecture-images/${userId}/${encodeDocId(lecId)}/${m.file}`;
    try {
      await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "image/jpeg" });
      const url = await getDownloadURL(storageRef(storage, path));
      out.push({ file: m.file, url, kind: m.kind, shows: m.shows || "", context: m.context || "" });
    } catch (e) {
      console.warn("lecture image upload failed:", m.file, e?.message);
    }
    onProgress?.(i + 1, usable.length);
  }
  return out;
}

// ─── QUESTION IMAGES ─────────────────────────────────

/**
 * Upload a single image file (File or Blob) attached to a drill question.
 * Stores the file in Firebase Storage and records metadata in
 * users/{uid}/questionImages. Returns the storage path on success, null on failure.
 */
export async function uploadQuestionImage(userId, objectiveId, round, file) {
  if (!userId || !objectiveId || !file) return null;
  const ext = file.name.split(".").pop() || "jpg";
  const safeName = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const path = `question-images/${userId}/${encodeDocId(objectiveId)}_r${round ?? 0}/${safeName}`;
  try {
    await uploadBytes(storageRef(storage, path), file, { contentType: file.type || "image/jpeg" });
    await setDoc(doc(db, "users", userId, "questionImages", encodeDocId(path)), {
      objectiveId,
      round: round ?? 0,
      storagePath: path,
      filename: file.name,
      mimeType: file.type || null,
      addedAt: serverTimestamp(),
    });
    return path;
  } catch (e) {
    console.warn("uploadQuestionImage exception:", e?.message);
    return null;
  }
}

/**
 * Fetch all image metadata for a question, with download URLs for display.
 * Returns [{storagePath, filename, mimeType, url, addedAt}]
 */
export async function fetchQuestionImages(userId, objectiveId, round) {
  if (!userId || !objectiveId) return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, "users", userId, "questionImages"),
        where("objectiveId", "==", objectiveId),
        where("round", "==", round ?? 0),
        orderBy("addedAt")
      )
    );
    if (snap.empty) return [];

    const withUrls = await Promise.all(
      snap.docs.map(async (d) => {
        const v = d.data();
        try {
          const url = await getDownloadURL(storageRef(storage, v.storagePath));
          return {
            storagePath: v.storagePath,
            filename: v.filename,
            mimeType: v.mimeType,
            url,
            addedAt: v.addedAt,
          };
        } catch {
          return null;
        }
      })
    );
    return withUrls.filter(Boolean);
  } catch (e) {
    console.warn("fetchQuestionImages exception:", e?.message);
    return [];
  }
}

/**
 * Delete a single question image by its storage path.
 */
export async function deleteQuestionImage(userId, storagePath) {
  if (!userId || !storagePath) return;
  try {
    await deleteObject(storageRef(storage, storagePath));
  } catch (e) {
    console.warn("deleteQuestionImage storage delete failed:", e?.message);
  }
  try {
    await deleteDoc(doc(db, "users", userId, "questionImages", encodeDocId(storagePath)));
  } catch (e) {
    console.warn("deleteQuestionImage exception:", e?.message);
  }
}

// ─── RECOGNITION-BANK TABLES (Task 6) ────────────────
// ankiCards / ungeneratedCards are client read/write; recognitionItems is
// server-write-only (allow write: if false in firestore.rules) — it is
// populated by the buildRecognitionBank Cloud Function (Task 7), so there is
// deliberately no client saveRecognitionItems helper here.

/** Upsert Anki-card rows (see ankiCards.js cardToRow) keyed by card_id. */
export async function saveAnkiCards(uid, cards) {
  if (!uid || !cards?.length) return { count: 0, error: null };
  const errors = [];
  const ops = cards.map((c) => (b) =>
    b.set(
      doc(db, "users", uid, "ankiCards", encodeDocId(c.card_id)),
      { ...c, updatedAt: serverTimestamp() },
      { merge: true }
    )
  );
  await commitInChunks(ops, errors);
  return { count: cards.length - errors.length, error: errors[0]?.error || null };
}

/** All Anki-card rows for this user. */
export async function getAnkiCards(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "ankiCards"));
    return snap.docs.map((d) => d.data());
  } catch (e) {
    console.warn("getAnkiCards exception:", e?.message);
    return [];
  }
}

/** Upsert ungenerated-card rows keyed by card_id (client Anki-ingest write; server marks generated). */
export async function saveUngeneratedCards(uid, cards) {
  if (!uid || !cards?.length) return { count: 0, error: null };
  const errors = [];
  const ops = cards.map((c) => (b) =>
    b.set(
      doc(db, "users", uid, "ungeneratedCards", encodeDocId(c.card_id ?? c.id)),
      { ...c, updatedAt: serverTimestamp() },
      { merge: true }
    )
  );
  await commitInChunks(ops, errors);
  return { count: cards.length - errors.length, error: errors[0]?.error || null };
}

/** All ungenerated-card rows for this user. */
export async function getUngeneratedCards(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "ungeneratedCards"));
    return snap.docs.map((d) => d.data());
  } catch (e) {
    console.warn("getUngeneratedCards exception:", e?.message);
    return [];
  }
}

/**
 * Anki struggle-tracker export → users/{uid}/struggleTasks, keyed by cardId.
 * Client-side counterpart of scripts/sync-struggle-tracker.mjs (which uses
 * firebase-admin to write the same shape from the exported JSON on disk).
 * setDone() is a local dismiss only — it never touches Anki, matching the
 * addon's one-way export.
 */
export async function saveStruggleTasks(uid, tasks) {
  if (!uid || !tasks?.length) return { count: 0, error: null };
  const errors = [];
  const ops = tasks.map((t) => (b) =>
    b.set(
      doc(db, "users", uid, "struggleTasks", encodeDocId(t.cardId)),
      { ...t, updatedAt: serverTimestamp() },
      { merge: true }
    )
  );
  await commitInChunks(ops, errors);
  return { count: tasks.length - errors.length, error: errors[0]?.error || null };
}

export async function getStruggleTasks(uid) {
  if (!uid) return [];
  try {
    const snap = await getDocs(collection(db, "users", uid, "struggleTasks"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("getStruggleTasks exception:", e?.message);
    return [];
  }
}

export async function deleteStruggleTask(uid, id) {
  if (!uid || !id) return;
  try {
    await deleteDoc(doc(db, "users", uid, "struggleTasks", id));
  } catch (e) {
    console.warn("deleteStruggleTask exception:", e?.message);
  }
}

export async function setStruggleTaskDone(uid, id, done) {
  if (!uid || !id) return;
  try {
    await setDoc(
      doc(db, "users", uid, "struggleTasks", id),
      { doneLocally: !!done, doneAt: done ? serverTimestamp() : null },
      { merge: true }
    );
  } catch (e) {
    console.warn("setStruggleTaskDone exception:", e?.message);
  }
}

/**
 * Final acknowledgement for a completed Struggle Tracker task. The document
 * stays as a tombstone while Anki still exports the card, preventing the next
 * desktop sync from resurrecting it. The sync job deletes the tombstone once
 * the card has actually left Anki's unresolved export.
 */
export async function releaseStruggleTask(uid, id) {
  if (!uid || !id) return;
  try {
    await setDoc(
      doc(db, "users", uid, "struggleTasks", id),
      { releasedLocally: true, releasedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    console.warn("releaseStruggleTask exception:", e?.message);
  }
}

/**
 * Read-only fetch of recognition-bank items for a block (optionally a subject).
 * recognitionItems is server-write-only — writes go through the
 * buildRecognitionBank Cloud Function, never the client.
 */
export async function getRecognitionItems(uid, blockId, subject) {
  if (!uid || !blockId) return [];
  try {
    const constraints = [where("block_id", "==", blockId), where("kind", "==", "vignette")];
    if (subject) constraints.push(where("subject", "==", subject));
    const snap = await getDocs(query(collection(db, "users", uid, "recognitionItems"), ...constraints, limit(200)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn("getRecognitionItems exception:", e?.message);
    return [];
  }
}

// ─── AUTO SYNC (call after key data changes) ──────────

let syncTimeout = null;

export function scheduleSyncToSupabase(userId) {
  if (!userId) return;
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(async () => {
    try {
      await pushAllLocalDataToSupabase(userId);
      console.log("Auto-sync complete");
    } catch (e) {
      console.error("Auto-sync failed:", e);
    }
  }, 30000);
}

// Short debounce for session / local edits — use immediate push for sign-in and manual "Save to cloud".

const DEBOUNCED_PUSH_MS = 3000;
let debouncedPushTimer = null;

export function clearDebouncedCloudPush() {
  if (debouncedPushTimer) {
    clearTimeout(debouncedPushTimer);
    debouncedPushTimer = null;
  }
}

export function scheduleDebouncedCloudPush(userId) {
  if (!userId) return;
  clearTimeout(debouncedPushTimer);
  debouncedPushTimer = setTimeout(async () => {
    debouncedPushTimer = null;
    try {
      const user = await getCurrentUser();
      if (!user || user.id !== userId) return;
      await pushAllLocalDataToSupabase(userId);
      console.log("Background cloud push complete");
    } catch (e) {
      console.warn("Background cloud push failed:", e?.message || e);
    }
  }, DEBOUNCED_PUSH_MS);
}
