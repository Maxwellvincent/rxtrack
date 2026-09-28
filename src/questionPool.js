import { collection, doc, getDocFromServer, getDocsFromServer, query, where, limit, setDoc, runTransaction } from "firebase/firestore";
import { db } from "./firebase.js";
import { getLecText } from "./lectureText.js";
import { MAX_EXAM_SESSION_BYTES, sessionBytes } from "./examSessions.js";

export const POOL_VERSION = 4;
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
  const validChoice = value => typeof value === "string" ? value.trim().length > 0
    : value && typeof value === "object" && !Array.isArray(value) && Object.values(value).some(cell => String(cell ?? "").trim());
  return typeof q?.stem === "string" && q.stem.trim().length > 0
    && q.choices && Object.keys(q.choices).length >= 2
    && Object.values(q.choices).every(validChoice)
    && Object.hasOwn(q.choices, q.correct);
}

export function summarizePoolRows(rows = []) {
  return {
    ready: rows.filter(row => row.status === "ready").length,
    assigned: rows.filter(row => row.status === "assigned").length,
    total: rows.length,
  };
}

export function summarizePreparedSets(generations = [], rows = []) {
  const questionById = new Map();
  const rowById = new Map(rows.map(row => [row.id, row]));
  const readyByGeneration = new Map();
  for (const row of rows) {
    if (row.status !== "ready" || !row.generationId || !row.question) continue;
    const question = { ...row.question, poolId: row.id, poolBucket: row.bucket };
    questionById.set(row.id, question);
    const list = readyByGeneration.get(row.generationId) || [];
    list.push(question);
    readyByGeneration.set(row.generationId, list);
  }
  return generations.map(generation => {
    const preparedQuestionIds = Array.isArray(generation.preparedQuestionIds) ? generation.preparedQuestionIds : null;
    const questions = preparedQuestionIds
      ? preparedQuestionIds.map(id => questionById.get(id)).filter(Boolean)
      : readyByGeneration.get(generation.id) || [];
    const preparedCount = preparedQuestionIds?.length ?? questions.length;
    const assignedCount = preparedQuestionIds
      ? preparedQuestionIds.filter(id => rowById.get(id)?.status === "assigned").length
      : 0;
    return { ...generation, questions, preparedCount, assignedCount };
  }).filter(set => set.prepareOnly && !set.startedSessionId && set.questions.length)
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
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
    async addPreparedQuestions(generationId, questions = []) {
      if (!generationId || !questions.length) return;
      const ref = runRef(generationId);
      await runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists() || !snap.data().prepareOnly) return;
        const ids = new Set(snap.data().preparedQuestionIds || []);
        for (const question of questions) if (question?.poolId) ids.add(question.poolId);
        tx.update(ref, { preparedQuestionIds: [...ids], updatedAt: Date.now() });
      });
    },
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
    async preparedSets() {
      const [generations, questions] = await Promise.all([
        getDocsFromServer(query(collection(db, "users", userId, "questionGenerations"), where("blockId", "==", blockId), limit(100))),
        getDocsFromServer(query(records, where("blockId", "==", blockId), limit(500))),
      ]);
      const generationRows = generations.docs.map(item => ({ id: item.id, ...item.data() }));
      const questionRows = questions.docs.map(item => ({ id: item.id, ...item.data() }));
      return summarizePreparedSets(generationRows, questionRows);
    },
    async deletePreparedSet(generationId) {
      if (!generationId) return { ok: false, error: "Missing prepared-set ID." };
      const generationRef = runRef(generationId);
      const questionSnap = await getDocsFromServer(query(records, where("generationId", "==", generationId), limit(500)));
      const refs = questionSnap.docs.map(item => item.ref);
      return runTransaction(db, async tx => {
        const [generation, ...questions] = await Promise.all([tx.get(generationRef), ...refs.map(ref => tx.get(ref))]);
        if (!generation.exists() || generation.data().blockId !== blockId || !generation.data().prepareOnly) {
          return { ok: false, error: "This prepared set is no longer available." };
        }
        let removed = 0, preserved = 0;
        questions.forEach((question, index) => {
          if (question.exists() && question.data().status === "ready" && question.data().generationId === generationId) {
            tx.delete(refs[index]);
            removed++;
          } else if (question.exists()) preserved++;
        });
        tx.delete(generationRef);
        return { ok: true, removed, preserved };
      });
    },
    async readyForGeneration(generationId, lectureId, questionIds = []) {
      const snap = await getDocsFromServer(query(records, where("blockId", "==", blockId), limit(500)));
      return snap.docs.filter(item => {
        const row = item.data();
        const belongs = questionIds.length ? questionIds.includes(item.id) : row.generationId === generationId;
        return row.status === "ready" && belongs && (!lectureId || row.lectureId === lectureId);
      }).map(item => ({ ...item.data().question, poolId: item.id, poolBucket: item.data().bucket })).filter(isValidPoolQuestion)
        .sort((a, b) => questionIds.length ? questionIds.indexOf(a.poolId) - questionIds.indexOf(b.poolId) : 0);
    },
    async ready(bucket) {
      // Assignment changes bucket, so one automatic single-field index suffices.
      const snap = await getDocsFromServer(query(records, where("bucket", "==", bucket), limit(100)));
      return snap.docs.map(d => ({ ...d.data().question, poolId: d.id, poolBucket: bucket })).filter(isValidPoolQuestion);
    },
    async readyForLectures(lectureIds = []) {
      // A reserve is broader than the current difficulty/objective bucket. For
      // an explicit saved-only launch, select from ready rows in the chosen
      // lecture scope, regardless of which generation bucket created them.
      const allowed = new Set((lectureIds || []).map(String));
      if (!allowed.size) return [];
      const snap = await getDocsFromServer(query(records, where("blockId", "==", blockId), limit(500)));
      return snap.docs
        .filter(d => d.data().status === "ready" && allowed.has(String(d.data().lectureId)))
        .map(d => ({ ...d.data().question, poolId: d.id, poolBucket: d.data().bucket }))
        .filter(isValidPoolQuestion);
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
    async appendToSession(sessionId, question, { requestedCount, durationMinutes, generationDone = false } = {}) {
      if (!question?.poolId) return { ok: false, reason: "missing-pool-id" };
      const sessionRef = doc(db, "users", userId, "examSessions", sessionId);
      const questionRef = doc(records, question.poolId);
      return runTransaction(db, async tx => {
        const [sessionSnap, questionSnap] = await Promise.all([tx.get(sessionRef), tx.get(questionRef)]);
        if (!sessionSnap.exists() || !questionSnap.exists()) return { ok: false, reason: "missing-record" };
        const session = sessionSnap.data();
        const row = questionSnap.data();
        if (session.status !== "in_progress" || row.status !== "ready") return { ok: false, reason: "no-longer-available" };
        const existing = session.questions || [];
        const alreadyIncluded = existing.some(item => item.poolId === question.poolId || item.questionId === question.questionId);
        const nextQuestions = alreadyIncluded ? existing : [...existing, question];
        tx.update(questionRef, { status: "assigned", bucket: `assigned:${row.bucket}`, sessionId, assignedAt: Date.now() });
        const isFilled = Number.isFinite(requestedCount) && nextQuestions.length >= requestedCount;
        const isDone = generationDone || isFilled;
        const now = Date.now();
        const next = {
          ...session,
          questions: nextQuestions,
          fillStatus: isDone ? (isFilled ? "complete" : "partial") : "generating",
          ...(isDone && session.format === "exam" && session.startedAt == null ? {
            startedAt: now,
            deadline: now + Math.max(1, Number(durationMinutes) || Number(session.durationMinutes) || 1) * 60_000,
          } : {}),
          updatedAt: now,
          rev: (session.rev || 0) + 1,
        };
        tx.set(sessionRef, next);
        return { ok: true, session: next };
      });
    },
    async finishSessionFill(sessionId, { requestedCount, durationMinutes, error = "" } = {}) {
      const sessionRef = doc(db, "users", userId, "examSessions", sessionId);
      return runTransaction(db, async tx => {
        const snap = await tx.get(sessionRef);
        if (!snap.exists()) return null;
        const session = snap.data();
        if (session.status !== "in_progress" || session.fillStatus !== "generating") return session;
        const now = Date.now();
        const filled = (session.questions || []).length >= requestedCount;
        const next = {
          ...session,
          fillStatus: filled ? "complete" : "partial",
          ...(error ? { fillError: error } : {}),
          ...(session.format === "exam" && session.startedAt == null ? {
            startedAt: now,
            deadline: now + Math.max(1, Number(durationMinutes) || Number(session.durationMinutes) || 1) * 60_000,
          } : {}),
          updatedAt: now,
          rev: (session.rev || 0) + 1,
        };
        tx.set(sessionRef, next);
        return next;
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
