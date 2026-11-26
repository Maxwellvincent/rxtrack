// Generated questions for score-report categories: prepared, still-unused
// rows in the learner's question pool (users/{uid}/questionPool) whose lecture
// is one of the categories' lectures. Launching a category session assigns
// them through the pool's own commit, exactly like a block exam.

import { collection, getDocsFromServer, query, where } from "firebase/firestore";
import { db } from "../../firebase.js";
import { isValidPoolQuestion } from "../../questionPool.js";

const IN_LIMIT = 30;

/** Ready pooled questions for these lectures, tagged as generated. */
export async function readyGeneratedForLectures(userId, lectureIds = [], deps = {}) {
  const ids = [...new Set((lectureIds || []).filter(Boolean).map(String))];
  if (!userId || !ids.length) return [];
  const database = deps.db || db;
  const load = deps.getDocs || getDocsFromServer;
  const at = deps.collection || collection, ask = deps.query || query, filter = deps.where || where;
  const records = at(database, "users", userId, "questionPool");
  const out = [];
  for (let start = 0; start < ids.length; start += IN_LIMIT) {
    const snap = await load(ask(records, filter("lectureId", "in", ids.slice(start, start + IN_LIMIT))));
    for (const row of snap.docs) {
      const data = row.data();
      if (data.status !== "ready") continue;
      const question = { ...data.question, poolId: row.id, poolBucket: data.bucket, lectureId: data.question?.lectureId || data.lectureId, sourceBlockId: data.blockId, sourceKind: "generated" };
      if (isValidPoolQuestion(question)) out.push({ ...question, questionId: question.questionId || `pool:${row.id}` });
    }
  }
  return out;
}
