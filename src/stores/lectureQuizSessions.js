/** Firestore-backed checkpoints for unfinished independent lecture quizzes. */
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { decodeDocId, encodeDocId } from "../idCodec.js";
import { stripUndefined } from "./cloudBase.js";
import { notifyStoreChanged, readJson, writeJson } from "./base.js";

export const key = "rxt-lecture-quiz-sessions";
const users = new Map();
let backend = null;

export function __setLectureQuizBackendForTests(value) { backend = value; users.clear(); }
function api() { return backend || { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc }; }
function entryFor(uid) {
  let entry = users.get(uid);
  if (!entry) {
    entry = { sessions: {}, hydrated: false, error: null, listeners: new Set(), pending: new Map(), unsubscribe: null, hydration: null };
    users.set(uid, entry);
  }
  return entry;
}
function notify(uid) {
  const entry = entryFor(uid);
  for (const callback of entry.listeners) callback();
  notifyStoreChanged(key, { userId: uid, source: "firestore" });
}
function collectionRef(uid) { return api().collection(db, "users", uid, "lectureQuizSessions"); }
function docRef(uid, id) { return api().doc(db, "users", uid, "lectureQuizSessions", encodeDocId(id)); }

export function hydrate(uid) {
  if (!uid) return Promise.resolve(read(uid));
  const entry = entryFor(uid);
  if (entry.hydrated) return Promise.resolve(entry.sessions);
  if (entry.hydration) return entry.hydration;
  entry.hydration = new Promise((resolve) => {
    entry.unsubscribe = api().onSnapshot(collectionRef(uid), (snapshot) => {
      const cloud = Object.fromEntries(snapshot.docs.map((item) => [decodeDocId(item.id), item.data()?.session]).filter(([, session]) => session));
      for (const [id, session] of entry.pending) {
        if (session) cloud[id] = session;
        else delete cloud[id];
      }
      entry.sessions = cloud;
      entry.hydrated = true;
      entry.error = null;
      notify(uid);
      resolve(entry.sessions);
    }, (error) => {
      entry.error = error;
      entry.hydrated = true;
      notify(uid);
      resolve(entry.sessions);
    });
  });
  return entry.hydration;
}

export function read(uid, lectureId = null, blockId = null) {
  const sessions = uid ? entryFor(uid).sessions : (readJson(uid, key, {}) || {});
  return Object.values(sessions).filter((session) => (!lectureId || session.lectureId === lectureId) && (!blockId || session.blockId === blockId));
}

export function subscribe(uid, callback) {
  if (!uid) return () => {};
  const entry = entryFor(uid);
  entry.listeners.add(callback);
  hydrate(uid).catch(() => {});
  return () => entry.listeners.delete(callback);
}

export function isHydrated(uid) { return !uid || entryFor(uid).hydrated; }
export function readError(uid) { return uid ? entryFor(uid).error : null; }

export async function save(uid, session) {
  if (!session?.id || !session?.lectureId || !Array.isArray(session.questions)) return false;
  const saved = stripUndefined({ ...session, updatedAt: Date.now() });
  if (!uid) {
    const sessions = { ...(readJson(uid, key, {}) || {}), [saved.id]: saved };
    try { writeJson(uid, key, sessions); notifyStoreChanged(key, { source: "local-write" }); return true; }
    catch { return false; }
  }
  const entry = entryFor(uid);
  entry.sessions = { ...entry.sessions, [saved.id]: saved };
  entry.pending.set(saved.id, saved);
  notify(uid);
  try {
    await api().setDoc(docRef(uid, saved.id), { session: saved, updatedAt: api().serverTimestamp() });
    entry.pending.delete(saved.id);
    entry.error = null;
    notify(uid);
    return true;
  } catch (error) {
    entry.error = error;
    notify(uid);
    return false;
  }
}

export async function remove(uid, id) {
  if (!id) return false;
  if (!uid) {
    const sessions = { ...(readJson(uid, key, {}) || {}) };
    delete sessions[id];
    try { writeJson(uid, key, sessions); notifyStoreChanged(key, { source: "local-write" }); return true; }
    catch { return false; }
  }
  const entry = entryFor(uid);
  const { [id]: _removed, ...remaining } = entry.sessions;
  entry.sessions = remaining;
  entry.pending.set(id, null);
  notify(uid);
  try {
    await api().deleteDoc(docRef(uid, id));
    entry.pending.delete(id);
    entry.error = null;
    notify(uid);
    return true;
  } catch (error) {
    entry.error = error;
    notify(uid);
    return false;
  }
}
