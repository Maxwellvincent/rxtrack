import { collection, doc, getDocFromServer, getDocsFromServer, query, where, limit, setDoc, runTransaction } from "firebase/firestore";
import { db } from "./firebase.js";
import { getLecText } from "./lectureText.js";
import { MAX_EXAM_SESSION_BYTES, sessionBytes } from "./examSessions.js";

export const POOL_VERSION = 3;
const clean = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export async function contentHash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}

// Learning status changes do not invalidate content; difficulty and the actual
// source text/objectives/atoms/exemplars do. Bump POOL_VERSION for prompt changes.
export function questionPoolKey({ blockId, lectureId, difficulty, lecture, objectives, atoms, exemplars, studyMode = "balanced" }) {
  return contentHash({ version: POOL_VERSION, blockId, lectureId, difficulty, studyMode,
    text: getLecText(lecture), title: lecture?.lectureTitle || lecture?.fileName || "",
    objectives: (objectives || []).map(o => ({ id: o.id, code: o.code, text: o.objective || o.text })),
    atoms: atoms || [], exemplars: (exemplars || []).map(q => ({ stem: q.stem, choices: q.choices, correct: q.correct })),
  });
}

export function isValidPoolQuestion(q) {
  return typeof q?.stem === "string" && q.stem.trim().length > 0 && q.choiceLayout !== "table"
    && q.choices && Object.keys(q.choices).length >= 2
    && Object.values(q.choices).every(v => typeof v === "string" && v.trim())
    && Object.hasOwn(q.choices, q.correct);
}

export function summarizePoolRows(rows = []) {
  return {
    ready: rows.filter(row => row.status === "ready").length,
    assigned: rows.filter(row => row.status === "assigned").length,
    total: rows.length,
  };
}

export function createQuestionPool(userId, blockId, database = db) {
  const db = database;
  const records = collection(db, "users", userId, "questionPool");
  const runRef = id => doc(db, "users", userId, "questionGenerations", id);
  return {
    async begin(id, metadata) {
      await setDoc(runRef(id), clean({ ...metadata, id, blockId, userId, status: "running", createdAt: Date.now(),
        provider: "existing bridge/cloud routing", model: null, tokenUsage: null, estimatedCost: null }));
    },
    async finish(id, metadata) { await setDoc(runRef(id), clean({ ...metadata, updatedAt: Date.now() }), { merge: true }); },
    async history() {
      const [sessions, calibration] = await Promise.all([
        getDocsFromServer(query(collection(db, "users", userId, "examSessions"), where("blockId", "==", blockId))),
        getDocFromServer(doc(db, "users", userId, "kv", "rxt-calibration")),
      ]);
      const usedSessionQuestions = sessions.docs.flatMap(d => {
        const session = d.data();
        if (session.status === "submitted" || session.status === "finalizing") return session.questions || [];
        const answered = new Set((session.answers || []).map(answer => answer.questionId));
        return (session.questions || []).filter(question => answered.has(question.questionId));
      });
      return [...usedSessionQuestions, ...(calibration.data()?.data?.[blockId] || [])];
    },
    async summary() {
      const snap = await getDocsFromServer(query(records, where("blockId", "==", blockId), limit(500)));
      return summarizePoolRows(snap.docs.map(d => d.data()));
    },
    async ready(bucket) {
      // Assignment changes bucket, so one automatic single-field index suffices.
      const snap = await getDocsFromServer(query(records, where("bucket", "==", bucket), limit(100)));
      return snap.docs.map(d => ({ ...d.data().question, poolId: d.id, poolBucket: bucket })).filter(isValidPoolQuestion);
    },
    async save(question, bucket, generationId) {
      const id = await contentHash({ blockId, stem: question.stem.toLowerCase().replace(/\s+/g, " ").trim() });
      const ref = doc(records, id);
      return runTransaction(db, async tx => {
        const old = await tx.get(ref);
        if (old.exists() && old.data().status === "assigned") return null;
        const saved = clean({ ...question, poolId: id, poolBucket: bucket });
        tx.set(ref, { blockId, lectureId: question.lectureId, difficulty: question.difficulty,
          bucket, sourceVersion: POOL_VERSION, generationId, status: "ready", createdAt: Date.now(), question: saved });
        return saved;
      });
    },
    async commit(session) {
      if (sessionBytes(session) > MAX_EXAM_SESSION_BYTES) return { ok: false, error: "Session too large; choose fewer questions. Prepared questions are saved." };
      const refs = session.questions.map(q => doc(records, q.poolId));
      return runTransaction(db, async tx => {
        const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
        if (snapshots.some((s, i) => !s.exists() || s.data().status !== "ready" || s.data().bucket !== session.questions[i].poolBucket)) {
          return { ok: false, error: "Another session used some of these questions. Retry to select unused questions; nothing was lost." };
        }
        // Set the clock only after generation and after transaction reads.
        const now = Date.now();
        const duration = session.deadline == null ? null : session.deadline - session.startedAt;
        const saved = { ...session, startedAt: duration == null ? null : now, deadline: duration == null ? null : now + duration };
        tx.set(doc(db, "users", userId, "examSessions", session.sessionId), clean(saved));
        snapshots.forEach((s, i) => tx.update(refs[i], { status: "assigned", bucket: `assigned:${s.data().bucket}`, sessionId: session.sessionId, assignedAt: now }));
        return { ok: true };
      });
    },
  };
}

export async function releaseUnansweredQuestions(userId, session, database = db) {
  if (!userId || !session) return { released: 0 };
  const answered = new Set((session.answers || []).map(answer => answer.questionId));
  const releasable = (session.questions || []).filter(question => question.poolId && !answered.has(question.questionId));
  if (!releasable.length) return { released: 0 };
  const refs = releasable.map(question => doc(database, "users", userId, "questionPool", question.poolId));
  let released = 0;
  await runTransaction(database, async tx => {
    const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
    snapshots.forEach((snapshot, index) => {
      const question = releasable[index];
      if (!snapshot.exists() || snapshot.data().sessionId !== session.sessionId) return;
      tx.update(refs[index], { status: "ready", bucket: question.poolBucket, sessionId: null, assignedAt: null });
      released += 1;
    });
  });
  return { released };
}

export async function releaseSessionQuestions(userId, session, database = db) {
  if (!userId || !session) return { released: 0 };
  const releasable = (session.questions || []).filter(question => question.poolId);
  if (!releasable.length) return { released: 0 };
  const refs = releasable.map(question => doc(database, "users", userId, "questionPool", question.poolId));
  let released = 0;
  await runTransaction(database, async tx => {
    const snapshots = await Promise.all(refs.map(ref => tx.get(ref)));
    snapshots.forEach((snapshot, index) => {
      const question = releasable[index];
      if (!snapshot.exists() || snapshot.data().sessionId !== session.sessionId) return;
      tx.update(refs[index], { status: "ready", bucket: question.poolBucket, sessionId: null, assignedAt: null });
      released += 1;
    });
  });
  return { released };
}
