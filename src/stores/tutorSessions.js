/**
 * Firestore-backed Guided Tutor checkpoints. Each lecture gets its own document;
 * the browser keeps only an in-memory working cache while the SDK queues cloud writes.
 * Legacy localStorage checkpoints are read only for migration and removed after the
 * complete migration is acknowledged by Firestore.
 */
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { decodeDocId, encodeDocId } from "../idCodec.js";
import { readJson, writeJson, physicalKey, notifyStoreChanged } from "./base.js";
import { stripUndefined } from "./cloudBase.js";

export const key = "rxt-tutor-sessions";
const fallback = {};
const users = new Map();
let backend = null;

export function __setTutorBackendForTests(value) {
  backend = value;
  users.clear();
}

function api() {
  return backend || { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc };
}

function userEntry(userId) {
  let entry = users.get(userId);
  if (!entry) {
    entry = { sessions: readLegacy(userId), history: {}, hydrated: false, error: null, statuses: {}, listeners: new Set(), pending: new Set(), unsubscribe: [], hydration: null, migration: null };
    users.set(userId, entry);
  }
  return entry;
}

function readLegacy(userId) {
  if (!userId) return {};
  const keys = [key, physicalKey(userId, key)];
  return keys.reduce((all, storageKey) => {
    try { return { ...all, ...(JSON.parse(localStorage.getItem(storageKey) || "{}")) }; }
    catch { return all; }
  }, {});
}

function removeLegacy(userId) {
  try {
    localStorage.removeItem(key);
    localStorage.removeItem(physicalKey(userId, key));
  } catch { /* The cloud copy is authoritative; stale legacy cache can be retried later. */ }
}

function notify(userId) {
  const entry = userEntry(userId);
  for (const callback of entry.listeners) callback();
  notifyStoreChanged(key, { userId, source: "firestore" });
}

function docRef(userId, lectureId) {
  const { doc: makeDoc } = api();
  return makeDoc(db, "users", userId, "tutorSessions", encodeDocId(lectureId));
}

function historyDocRef(userId, sessionId) {
  const { doc: makeDoc } = api();
  return makeDoc(db, "users", userId, "tutorHistory", encodeDocId(sessionId));
}

function compactSession(session, turnLimit = 16, responseLimit = 700) {
  const turns = Array.isArray(session?.turns) ? session.turns : [];
  const objectiveStartedIds = [...new Set([
    ...(session?.objectiveStartedIds || []),
    ...turns.map((turn) => String(turn?.objectiveId || "")),
  ].filter(Boolean).map(String))];
  const profile = session?.learnerProfile || {};
  return stripUndefined({
    ...session,
    objectiveStartedIds,
    turns: turns.slice(-turnLimit).map((turn) => ({
      ...turn,
      response: String(turn?.response || "").slice(0, responseLimit),
      feedback: String(turn?.feedback || "").slice(0, 500),
      followUp: String(turn?.followUp || "").slice(0, 300),
    })),
    learnerProfile: {
      ...profile,
      confirmedAnchors: (profile.confirmedAnchors || []).slice(-10).map((item) => ({ ...item, response: String(item.response || "").slice(0, responseLimit) })),
      recentMisses: (profile.recentMisses || []).slice(-10).map((item) => ({ ...item, repairLink: String(item.repairLink || "").slice(0, 180) })),
      confidenceEvents: (profile.confidenceEvents || []).slice(-16),
      reasoningSkillEvidence: (profile.reasoningSkillEvidence || []).slice(-24),
    },
  });
}

function migrateLegacy(userId, entry, cloudSessions = {}) {
  if (entry.migration || !userId) return entry.migration;
  const legacy = readLegacy(userId);
  const missing = Object.entries(legacy).filter(([lectureId]) => !cloudSessions[lectureId]);
  if (!missing.length) {
    removeLegacy(userId);
    return Promise.resolve(true);
  }
  entry.migration = Promise.all(missing.map(async ([lectureId, session]) => {
    const { setDoc: put, serverTimestamp: stamp } = api();
    await put(docRef(userId, lectureId), { session: compactSession(session), updatedAt: stamp() });
    entry.sessions[lectureId] = session;
  })).then(() => {
    removeLegacy(userId);
    entry.migration = null;
    notify(userId);
    return true;
  }).catch((error) => {
    entry.error = error;
    entry.migration = null;
    console.warn("Tutor checkpoint migration failed; the legacy browser copy was retained", error?.message || error);
    notify(userId);
    return false;
  });
  return entry.migration;
}

/** Start the user-scoped listener and resolve after Firestore's first snapshot. */
export function hydrate(userId) {
  if (!userId) return Promise.resolve({});
  const entry = userEntry(userId);
  if (entry.hydrated) return Promise.resolve(entry.sessions);
  if (entry.hydration) return entry.hydration;
  const { collection: makeCollection, onSnapshot: watch } = api();
  entry.hydration = new Promise((resolve) => {
    let sessionsReady = false;
    let historyReady = false;
    const finishHydration = () => {
      if (sessionsReady && historyReady) {
        entry.hydrated = true;
        notify(userId);
        resolve(entry.sessions);
      }
    };
    entry.unsubscribe.push(watch(
      makeCollection(db, "users", userId, "tutorSessions"),
      (snapshot) => {
        const cloud = Object.fromEntries(snapshot.docs.map((item) => [decodeDocId(item.id), item.data()?.session]).filter(([, state]) => state));
        const localOnly = Object.fromEntries(Object.entries(readLegacy(userId)).filter(([lectureId]) => !cloud[lectureId]));
        const optimistic = Object.fromEntries([...entry.pending].map((lectureId) => [lectureId, entry.sessions[lectureId]]).filter(([, state]) => state));
        entry.sessions = { ...localOnly, ...cloud, ...optimistic };
        entry.error = null;
        migrateLegacy(userId, entry, cloud);
        sessionsReady = true;
        notify(userId);
        finishHydration();
      },
      (error) => {
        entry.error = error;
        sessionsReady = true;
        finishHydration();
      }
    ));
    entry.unsubscribe.push(watch(
      makeCollection(db, "users", userId, "tutorHistory"),
      (snapshot) => {
        entry.history = Object.fromEntries(snapshot.docs.map((item) => [decodeDocId(item.id), item.data()?.session]).filter(([, state]) => state));
        historyReady = true;
        finishHydration();
      },
      (error) => {
        entry.error = error;
        historyReady = true;
        finishHydration();
      }
    ));
  });
  return entry.hydration;
}

export function read(userId) {
  if (!userId) return readJson(userId, key, fallback) || fallback;
  return userEntry(userId).sessions;
}

export function get(userId, lectureId) {
  if (!lectureId) return null;
  return read(userId)[lectureId] || null;
}

export function getLearnerProfile(userId) {
  const entry = userId ? userEntry(userId) : null;
  const profiles = [
    ...Object.values(read(userId)),
    ...Object.values(entry?.history || {}),
  ].map((session) => session?.learnerProfile).filter(Boolean);
  const collect = (field, limit) => [...new Map(profiles.flatMap((profile) => profile[field] || [])
    .map((item) => [JSON.stringify(item), item])).values()]
    .sort((a, b) => (a.at || 0) - (b.at || 0))
    .slice(-limit);
  const reasoningSkillEvidence = collect("reasoningSkillEvidence", 40);
  const stableReasoningSkills = [...new Set(reasoningSkillEvidence
    .filter((item) => reasoningSkillEvidence.some((other) => other.skill === item.skill && other.objectiveId !== item.objectiveId))
    .map((item) => item.skill))];
  return {
    confirmedAnchors: collect("confirmedAnchors", 16),
    recentMisses: collect("recentMisses", 16),
    confidenceEvents: collect("confidenceEvents", 32),
    reasoningSkillEvidence,
    stableReasoningSkills,
  };
}

export function write(userId, value) {
  if (!userId) return writeJson(userId, key, value || fallback);
  const entry = userEntry(userId);
  const sessions = value || {};
  return Promise.all(Object.entries(sessions).map(([lectureId, session]) => save(userId, session || { lectureId })))
    .then(() => entry.sessions);
}

/** Optimistic in-memory update followed by an asynchronous Firestore write. */
export function save(userId, state) {
  if (!state?.lectureId) return userId ? Promise.resolve(read(userId)) : read(userId);
  if (!userId) {
    const next = { ...read(userId), [state.lectureId]: compactSession(state) };
    try { writeJson(userId, key, next); return true; }
    catch { return false; }
  }
  const entry = userEntry(userId);
  const lectureId = String(state.lectureId);
  const session = compactSession(state);
  const previous = entry.sessions[lectureId];
  if (previous?.sessionId && session.sessionId && previous.sessionId !== session.sessionId && !entry.history[previous.sessionId]) {
    const archived = compactSession(previous);
    entry.history = { ...entry.history, [previous.sessionId]: archived };
    const { setDoc: putArchive, serverTimestamp: archiveStamp } = api();
    Promise.resolve(putArchive(historyDocRef(userId, previous.sessionId), { session: archived, archivedAt: archiveStamp() }))
      .catch((error) => {
        entry.error = error;
        entry.statuses[lectureId] = "error";
        console.warn("Tutor history archive failed", error?.message || error);
        notify(userId);
      });
  }
  entry.sessions = { ...entry.sessions, [lectureId]: session };
  entry.pending.add(lectureId);
  entry.statuses[lectureId] = "syncing";
  notify(userId);
  const { setDoc: put, serverTimestamp: stamp } = api();
  const pending = Promise.resolve(put(docRef(userId, lectureId), { session, updatedAt: stamp() }))
    .then(() => {
      entry.pending.delete(lectureId);
      entry.statuses[lectureId] = "saved";
      entry.error = null;
      notify(userId);
      return true;
    })
    .catch((error) => {
      entry.statuses[lectureId] = "error";
      entry.error = error;
      console.warn("Tutor checkpoint Firestore write failed", error?.message || error);
      notify(userId);
      return false;
    });
  return pending;
}

export function clear(userId, lectureId) {
  if (!lectureId) return Promise.resolve(read(userId));
  if (!userId) {
    const { [lectureId]: _removed, ...rest } = read(userId);
    writeJson(userId, key, rest);
    return rest;
  }
  const entry = userEntry(userId);
  const { [lectureId]: _removed, ...rest } = entry.sessions;
  entry.sessions = rest;
  delete entry.statuses[lectureId];
  notify(userId);
  const { deleteDoc: remove } = api();
  return Promise.resolve(remove(docRef(userId, lectureId))).then(() => rest);
}

export function historyForLecture(userId, lectureId) {
  const entry = userId ? userEntry(userId) : null;
  return Object.values(entry?.history || {})
    .filter((session) => session?.lectureId === lectureId)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

export function subscribe(userId, callback) {
  if (!userId) return () => {};
  const entry = userEntry(userId);
  entry.listeners.add(callback);
  hydrate(userId).catch(() => {});
  return () => entry.listeners.delete(callback);
}

export function isHydrated(userId) {
  return !userId || userEntry(userId).hydrated;
}

export function syncStatus(userId, lectureId) {
  if (!userId) return "local";
  const entry = userEntry(userId);
  return entry.statuses[lectureId] || (entry.error ? "error" : entry.hydrated ? "saved" : "loading");
}

export function readError(userId) {
  return userId ? userEntry(userId).error : null;
}
