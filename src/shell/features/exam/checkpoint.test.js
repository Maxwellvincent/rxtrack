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
 let listener;let serverData;
 const put = vi.fn().mockRejectedValueOnce(new Error("connection lost")).mockResolvedValue(undefined);
 __setCloudBackendForTests({ doc: (_db,...parts)=>parts.join("/"), onSnapshot: (_path,next)=>{listener=next;return ()=>{};}, setDoc: put, runTransaction:async(_db,fn)=>{let write;const value=await fn({get:async()=>({exists:()=>true,data:()=>({data:serverData})}),set:(ref,data)=>{write=[ref,data];}});await put(...write);serverData=write[1].data;return value;},serverTimestamp:()=>"server" });
 try {
   const first=checkpointExamSession("checkpoint-user","s1");
   await Promise.resolve(); await Promise.resolve();
   expect(put).not.toHaveBeenCalled();
   serverData=evidence.applyEvidence(null,{questionKey:"old",objectiveIds:["old-objective"],correct:true});listener({ exists:()=>true, data:()=>({data:serverData}) });
   await expect(first).rejects.toThrow("connection lost");
   expect(state.session.status).toBe("in_progress");
   await checkpointExamSession("checkpoint-user","s1");
   expect(put).toHaveBeenCalledTimes(2);
   const rawSaved=put.mock.calls[1][1].data;const saved=(rawSaved.evidenceJournal||[]).reduce((m,e)=>evidence.applyEvidence(m,e),rawSaved.evidenceBaseline||rawSaved);
   expect(saved.total).toBe(2);
   expect(saved.objectives["old-objective"].attempts).toBe(1);
   expect(saved.objectives.o.attempts).toBe(1);
 } finally { resetCloudStores(); __setCloudBackendForTests(null); }
});

it("clears a saved selection without leaving an incorrect attempt behind",async()=>{
 await checkpointExamSession(null,'s1');
 expect(evidence.read(null).total).toBe(1);
 state.session.answers=[{questionId:'q1',value:null}];
 await checkpointExamSession(null,'s1');
 expect(evidence.read(null).total).toBe(0);
 expect(lectureStats.statsForLecture(null,'l').answered).toBe(0);
});
it('retracts only a conflicting-key checkpoint and preserves its raw answer for repair',async()=>{
 state.session.answers.push({questionId:'q2',value:'A',answeredAt:20});
 await checkpointExamSession(null,'s1');
 expect(evidence.read(null).total).toBe(2);
 state.session.questions[0]={...state.session.questions[0],correct:null,sourceKeyReviewStatus:'key-text-conflict'};
 const saved=await checkpointExamSession(null,'s1');
 expect(saved.answers).toHaveLength(2);
 expect(scoredSessionSnapshot(saved).answers.map(a=>a.questionId)).toEqual(['q2']);
 expect(evidence.read(null)).toMatchObject({total:1,correct:1});
 expect(evidence.read(null).objectives.o).toMatchObject({attempts:1,correct:1});
});
it('withholds unconfirmed visual choices and restores the same event after confirmation',async()=>{
 state.session.questions[0].sourceVisualChoicesUnverified=true;
 await checkpointExamSession(null,'s1');expect(evidence.read(null).total).toBe(0);
 state.session.questions[0].sourceVisualLabelsConfirmed=true;
 await checkpointExamSession(null,'s1');expect(evidence.read(null).total).toBe(1);
 await checkpointExamSession(null,'s1');expect(evidence.read(null).total).toBe(1);
});
it('honors objective-only exclusions while retaining a valid lecture attempt',async()=>{
 const ratings=await import('../../../stores/questionRatings.js');
 const spy=vi.spyOn(ratings,'read').mockReturnValue({ratings:{r:{evidenceKey:evidence.questionEvidenceKey('q1'),sourceIssue:'source-mismatch'}}});
 try{
  await checkpointExamSession(null,'s1');
  expect(evidence.read(null).total).toBe(1);
  expect(evidence.read(null).objectives.o?.attempts || 0).toBe(0);
  expect(lectureStats.statsForLecture(null,'l').answered).toBe(1);
 }finally{spy.mockRestore();}
});

it('saves a reserved assessment without publishing partial correctness or changing its deadline',async()=>{
 state.session.purpose='reserved-assessment';
 const result=await checkpointExamSession(null,'s1');
 expect(result.deadline).toBe(12345);expect(result.answers).toHaveLength(1);
 expect(result.assessmentSavedAt).toBeTypeOf('number');expect(result.progressSavedAt).toBeUndefined();
 expect(scoredSessionSnapshot({...result,progressSavedAt:20,checkpointAnswers:result.answers})).toBeNull();
 expect(evidence.read(null).total || 0).toBe(0);
});
