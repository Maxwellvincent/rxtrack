import { expect, it, vi } from "vitest";
import { recoverExamPreparation, waitForConnection, holdPreparationWorker,missingRecoveryAllocation } from "./preparationRecovery.js";
import {answerRoute} from '../../../engine/testFixtures/answerRoute.js';
import {REASONING_REVIEW_POLICY} from '../../../engine/questionOrder.js';
import {QUESTION_REUSE_REVIEW_POLICY} from '../../../engine/questionReuse.js';
const session = { sessionId: "s", blockId: "b", status: "in_progress", fillStatus: "partial", fillError: "AI request timed out", targetQuestionCount: 3, lectureIds: ["l"], questions: [{ lectureId: "l" }], fillPlan: { allocation: { l: 3 } } };
it('fills from a current reviewed unused reserve before spending model requests',async()=>{
 const stem='The response persists after upstream input is blocked.';
 const q={poolId:'fresh',questionId:'fresh',lectureId:'l',blockId:'b',stem,choices:{A:'Local response',B:'Upstream response'},correct:'A',generationVersion:'v2',objectiveIds:['o'],orderLevel:'second-order',reasoningAudit:{status:'verified',version:2,reviewPolicy:REASONING_REVIEW_POLICY,orderLevel:'second-order',connectedChain:true,singleEndpoint:true,choiceShortcut:false},qualityAudit:{blindSolve:{answerRoute:answerRoute(stem),status:'matched',answer:'A',sourceQuotes:['Source-supported local response relationship.']},discrimination:{closestAlternative:'B',stemClue:'persists after upstream input is blocked',whyAlternativeFails:'The response does not depend on the blocked input.',keyUniquelySupported:true,alternativeAlsoCorrect:false},status:'approved',reviewPolicy:QUESTION_REUSE_REVIEW_POLICY,reviewedAt:'2026-10-31T12:00:00Z',semanticObjectiveAlignment:true,objectiveId:'o'}};
 const current={...session,targetQuestionCount:2,answers:[{questionId:'old',value:'B'}]};
 const pool={claimSessionFill:vi.fn(async()=>current),readyForLectures:vi.fn(async()=>[{...q,generationVersion:'v1',poolId:'stale'},q]),history:vi.fn(async()=>[]),appendToSession:vi.fn(async()=>({ok:true})),finishSessionFill:vi.fn(async()=>({...current,questions:[...current.questions,q]}))};
 const generate=vi.fn();
 await recoverExamPreparation({session:current,userId:'u',pool,generate,context:{objectivesByLecture:{l:[{id:'o'}]}},manual:true});
 expect(generate).not.toHaveBeenCalled();expect(pool.appendToSession).toHaveBeenCalledOnce();
 expect(pool.appendToSession.mock.calls[0][1].poolId).toBe('fresh');
 expect(current.answers).toEqual([{questionId:'old',value:'B'}]);
});
it("resumes only missing slots and keeps rejected quality items excluded", async () => {
 const pool = { claimSessionFill: vi.fn(async () => ({ ...session, fillBlockedLectureIds: ["bad"], fillPlan: { allocation: { l: 3, bad: 2 } } })), finishSessionFill: vi.fn(), appendToSession: vi.fn(), reportSessionFillProgress: vi.fn() };
 const generate = vi.fn(async () => ({ questions: [], errors: [{ lectureId: "l", message: "weak_explanation" }] }));
 await expect(recoverExamPreparation({ session, userId: "u", pool, generate, context: {} })).rejects.toThrow('weak_explanation');
 expect(generate.mock.calls[0][0].allocation).toEqual({ l: 2 });
 expect(pool.finishSessionFill.mock.calls[0][1].blockedLectureIds).toEqual(["bad", "l"]);
});
it('reconciles a stale fulfilled lecture plan with five missing questions in a 32-question exam',()=>{
 const q=Array.from({length:27},()=>({lectureId:'l'}));
 expect(missingRecoveryAllocation({targetQuestionCount:32,questions:q,fillPlan:{allocation:{l:27}}})).toEqual({l:5});
 expect(missingRecoveryAllocation({targetQuestionCount:32,questions:q,fillPlan:{allocation:{l:40}}})).toEqual({l:5});
});
it('surfaces an actual partial result instead of resolving the manual retry as successful',async()=>{
 const pool={claimSessionFill:vi.fn(async()=>session),finishSessionFill:vi.fn(async()=>session),appendToSession:vi.fn(),reportSessionFillProgress:vi.fn()};
 await expect(recoverExamPreparation({session,userId:'u',pool,generate:async()=>({errors:[]}),context:{},manual:true})).rejects.toThrow('1/3 questions saved');
});
it('passes existing unanswered questions into generation to prevent duplicate refills',async()=>{
 const pool={claimSessionFill:vi.fn(async()=>session),finishSessionFill:vi.fn(),appendToSession:vi.fn(),reportSessionFillProgress:vi.fn()};
 const generate=vi.fn(async()=>({errors:[]}));
 await recoverExamPreparation({session,userId:'u',pool,generate,context:{},manual:true});
 expect(generate.mock.calls[0][0].existingQuestions).toEqual(session.questions);
});
it('allows an explicit retry after quality failures and automatic retry exhaustion, preserving answered items',async()=>{
 const answered={...session,fillError:'reviewer rejected weak_explanation',fillRecoveryAttempts:3,answers:[{questionId:'existing',value:'B'}],questions:[{questionId:'existing',lectureId:'l',choices:{A:'a',B:'b'}}],fillBlockedLectureIds:['l']};
 const pool={claimSessionFill:vi.fn(async()=>answered),finishSessionFill:vi.fn(),appendToSession:vi.fn(),reportSessionFillProgress:vi.fn()};
 const generate=vi.fn(async()=>({errors:[]}));
 await recoverExamPreparation({session:answered,userId:'u',pool,generate,context:{},manual:true});
 expect(pool.claimSessionFill).toHaveBeenCalledWith('s',answered.fillPlan,{manual:true});
 expect(generate.mock.calls[0][0].allocation).toEqual({l:2});
 expect(answered.answers).toEqual([{questionId:'existing',value:'B'}]);
 expect(answered.questions[0].choices).toEqual({A:'a',B:'b'});
});
it("does not automatically retry quality failures or exhausted recovery attempts", async () => {
 const pool = { claimSessionFill: vi.fn() };
 for (const patch of [{ fillError: "reviewer rejected weak_explanation" }, { fillRecoveryAttempts: 3 }]) {
  await recoverExamPreparation({ session: { ...session, ...patch }, userId: "u", pool });
 }
 expect(pool.claimSessionFill).not.toHaveBeenCalled();
});

it("retries missing slots after an empty structured response and clears stale lecture blocks", async () => {
 const emptySession = { ...session, fillError: "bridge 502: ollama-cloud: empty reply", fillBlockedLectureIds: ["l"] };
 const pool = { claimSessionFill: vi.fn(async () => ({ ...emptySession, fillPlan: { allocation: { l: 3 } } })), finishSessionFill: vi.fn(), appendToSession: vi.fn(), reportSessionFillProgress: vi.fn() };
 const generate = vi.fn(async () => ({ questions: [], errors: [] }));
 await recoverExamPreparation({ session: emptySession, userId: "u", pool, generate, context: {} });
 expect(generate.mock.calls[0][0].allocation).toEqual({ l: 2 });
 expect(pool.finishSessionFill.mock.calls[0][1].blockedLectureIds).toEqual([]);
});

it("waits offline and wakes on reconnect", async () => {
 const events = new EventTarget();
 vi.stubGlobal("navigator", { onLine: false }); vi.stubGlobal("window", events);
 try {
  const done = vi.fn(); const waiting = waitForConnection().then(done);
  await Promise.resolve(); expect(done).not.toHaveBeenCalled();
  events.dispatchEvent(new Event("online")); await waiting;
  expect(done).toHaveBeenCalledOnce();
 } finally { vi.unstubAllGlobals(); }
});
it("does not launch recovery beside an existing live worker", async () => {
 const release = holdPreparationWorker("u", "s"); const pool = { claimSessionFill: vi.fn() };
 try { await recoverExamPreparation({ session, userId: "u", pool }); expect(pool.claimSessionFill).not.toHaveBeenCalled(); }
 finally { release(); }
});

it('does not auto-retry capacity failures or mark their lecture content permanently blocked',async()=>{
 const {connectionFailure,blocksPreparationLecture}=await import('./preparationRecovery.js');
 const message='AI capacity unavailable: Codex usage limit reached; Ollama Cloud HTTP 429';
 expect(connectionFailure(message)).toBe(false);expect(blocksPreparationLecture(message)).toBe(false);
 const pool={claimSessionFill:vi.fn()};
 await recoverExamPreparation({session:{...session,fillError:message},userId:'u',pool});
 expect(pool.claimSessionFill).not.toHaveBeenCalled();
});
