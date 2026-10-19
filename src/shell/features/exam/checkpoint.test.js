import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ session: null }));
vi.mock("../../../supabase.js", () => ({ updateExamSessionTransaction: async (_u, _id, update) => { state.session = update(state.session) || state.session; return state.session; } }));
import { checkpointExamSession, scoredSessionSnapshot } from "./checkpoint.js";
import * as lectureStats from "../../../stores/lectureQuestionStats.js";
import { sessionEvidenceEvent } from "./sessionEvidence.js";
import * as evidence from "../../../stores/learnerEvidence.js";
import { installDomStorage } from "../../../stores/testEnv.js";
beforeEach(() => {
 installDomStorage();
 state.session = { sessionId: "s1", blockId: "b", status: "in_progress", deadline: 12345, resumePosition: { index: 1 },
 questions: [1,2,3].map(n => ({ questionId: `q${n}`, lectureId: "l", objectiveIds: ["o"], choices: { A: "One", B: "Two" }, correct: "A" })),
 answers: [{ questionId: "q1", value: "B", answeredAt: 10 }] };
});
it("publishes completed answers while keeping the session, timer and bookmark resumable", async () => {
 const result = await checkpointExamSession(null, "s1");
 expect(result).toMatchObject({ status: "in_progress", deadline: 12345, resumePosition: { index: 1 } });
 expect(scoredSessionSnapshot(result).answers).toHaveLength(1);
 expect(evidence.read(null).objectives.o).toMatchObject({ attempts: 1, correct: 0 });
 expect(evidence.read(null).total).toBe(1);
 expect(lectureStats.statsForLecture(null, "l")).toMatchObject({ answered: 1, correct: 0 });
 await checkpointExamSession(null, "s1");
 expect(evidence.read(null).total).toBe(1);
 state.session.answers.push({ questionId: "q2", value: "A", answeredAt: 20 });
 await checkpointExamSession(null, "s1");
 expect(evidence.read(null).total).toBe(2);
 expect(evidence.read(null).objectives.o).toMatchObject({ attempts: 2, correct: 1 });
 state.session.status = "finalizing";
 // Final submission shares the event identity: it cannot count the saved work twice.
 for (const answer of state.session.answers) {
   const question = state.session.questions.find(q=>q.questionId===answer.questionId);
   await lectureStats.recordAnswerAwait(null, question.lectureId, answer.value === question.correct, `exam:s1:${question.questionId}`);
   expect(lectureStats.statsForLecture(null, "l").answered).toBe(2);
   await evidence.recordEvidenceAwait(null, sessionEvidenceEvent(state.session, question, answer));
 }
 expect(lectureStats.statsForLecture(null, "l")).toMatchObject({ answered: 2, correct: 1 });
 expect(evidence.read(null).total).toBe(2);
});
it("replaces changed answers without an extra attempt and hides picks after the checkpoint", async () => {
 await checkpointExamSession(null, "s1");
 state.session.answers = [{ questionId: "q1", value: "A", answeredAt: 30 }, { questionId: "q2", value: "A" }];
 expect(scoredSessionSnapshot(state.session).answers[0].value).toBe("B");
 await checkpointExamSession(null, "s1");
 expect(evidence.read(null)).toMatchObject({ total: 2, correct: 2 });
});
it("ignores unsaved or abandoned progress and retains quality exclusions", async () => {
 expect(scoredSessionSnapshot(state.session)).toBeNull();
 await checkpointExamSession(null, "s1");
 const ratings = { bad: { excludeFromPerformance: true, evidenceKey: evidence.questionEvidenceKey("q1") } };
 expect(scoredSessionSnapshot(state.session, ratings).answers).toEqual([]);
 expect(scoredSessionSnapshot({ ...state.session, status: "abandoned" })).toBeNull();
});

it("preserves hydrated cloud history and retries a failed publish without duplication", async () => {
 const { __setCloudBackendForTests, resetCloudStores } = await import("../../../stores/cloudBase.js");
 let listener;
 const put = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(undefined);
 __setCloudBackendForTests({ doc: (_db,...parts)=>parts.join("/"), onSnapshot: (_path,next)=>{listener=next;return ()=>{};}, setDoc: put, serverTimestamp:()=>"server" });
 try {
   const first=checkpointExamSession("checkpoint-user","s1");
   await Promise.resolve(); await Promise.resolve();
   expect(put).not.toHaveBeenCalled();
   listener({ exists:()=>true, data:()=>({data:evidence.applyEvidence(null,{questionKey:"old",objectiveIds:["old-objective"],correct:true})}) });
   await expect(first).rejects.toThrow("connection lost");
   expect(state.session.status).toBe("in_progress");
   await checkpointExamSession("checkpoint-user","s1");
   expect(put).toHaveBeenCalledTimes(2);
   const saved=put.mock.calls[1][1].data;
   expect(saved.total).toBe(2);
   expect(saved.objectives["old-objective"].attempts).toBe(1);
   expect(saved.objectives.o.attempts).toBe(1);
 } finally { resetCloudStores(); __setCloudBackendForTests(null); }
});
