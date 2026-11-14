import {answerRoute} from '../../../engine/testFixtures/answerRoute.js';
import { QUESTION_REUSE_REVIEW_POLICY } from "../../../engine/questionReuse.js";
import { REASONING_REVIEW_POLICY } from "../../../engine/questionOrder.js";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateExamQuestions, alreadyUsed } from "./generation.js";
const generate = vi.hoisted(() => vi.fn());
vi.mock("../objectives/quizLaunch.js", async importOriginal => ({ ...await importOriginal(), startObjectiveQuiz: (...a) => generate(...a), readClinicalAnalysesForBlock: () => [], readExemplarsForBlock: () => [], resolveDefaultDifficulty: () => "medium" }));
const q = stem => ({ generationVersion: "v2", orderLevel: "second-order", qualityAudit: { blindSolve: {answerRoute:answerRoute(stem),status:"matched",answer:"A",sourceQuotes:["Source-supported local response relationship."]}, discrimination: { closestAlternative: "B", stemClue: stem, whyAlternativeFails: "The alternative contradicts the supplied finding.", keyUniquelySupported: true, alternativeAlsoCorrect: false }, status: "approved", reviewPolicy: QUESTION_REUSE_REVIEW_POLICY, reviewedAt: "2026-10-31T12:00:00Z" }, reasoningAudit: { status: "verified", version: 2, reviewPolicy: REASONING_REVIEW_POLICY, orderLevel: "second-order", connectedChain: true, singleEndpoint: true, choiceShortcut: false }, stem, choices: { A: "yes", B: "no" }, correct: "A" });
const args = { allocation: { l1: 1, l2: 1, l3: 1 }, lecturesById: Object.fromEntries(["l1", "l2", "l3"].map(id => [id, { id, fullText: "Supplied lecture factual evidence. ".repeat(20) }])), objectivesByLecture: {}, atomsByLecture: {}, blockId: "b", lectures: [], userId: null, generationId: "g" };
const pool = () => ({ history: vi.fn(async () => []), ready: vi.fn(async () => []), save: vi.fn(async question => ({ ...question, poolId: question.questionId })) });
beforeEach(() => { generate.mockReset(); });
afterEach(() => vi.useRealTimers());
describe("parallel generation with durable reuse", () => {
  it("runs three remote workers concurrently for three lecture slots", async () => {
    vi.useFakeTimers();
    let active = 0, peak = 0, count = 0;
    generate.mockImplementation(async () => {
      active++; peak = Math.max(peak, active); const id = ++count;
      await new Promise(resolve => setTimeout(resolve, 100)); active--;
      return { questions: [q(`Distinct${id}`)] };
    });
    const result = generateExamQuestions(args);
    await vi.advanceTimersByTimeAsync(100);
    expect(count).toBe(3);
    expect(peak).toBe(3);
    expect((await result).questions).toHaveLength(3);
  });
  it("uses prepared questions without AI and persists newly generated questions", async () => {
    const storage = pool();
    storage.ready.mockResolvedValueOnce([{ ...q("Stored finding"), poolId: "saved", lectureId: "l1" }]);
    generate.mockResolvedValue({ questions: [q("Fresh finding")] });
    const result = await generateExamQuestions({ ...args, allocation: { l1: 1, l2: 1 } }, { pool: storage });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(result.cacheHits).toBe(1);
    expect(result.questions).toHaveLength(2);
  });
  it("saved-only launches reuse ready questions across generation buckets for the scoped lecture", async () => {
    const storage = pool();
    storage.readyForLectures = vi.fn(async () => [
      { ...q("Saved from another bucket"), poolId: "saved-1", poolBucket: "old-bucket", lectureId: "l1" },
    ]);
    const result = await generateExamQuestions({ ...args, allocation: { l1: 1 } }, { pool: storage, savedOnly: true });
    expect(storage.readyForLectures).toHaveBeenCalledWith(["l1"]);
    expect(storage.ready).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(result.questions.map(question => question.stem)).toEqual(["Saved from another bucket"]);
  });
  it("does not award a sole objective to an untagged saved question without reviewed ownership", async () => {
    const storage = pool();
    const original = { ...q("Stored finding"), poolId: "saved", lectureId: "l1" };
    storage.ready.mockResolvedValueOnce([original]);
    const result = await generateExamQuestions({ ...args, allocation: { l1: 1 }, objectivesByLecture: { l1: [{ id: "obj1" }] } }, { pool: storage, savedOnly: true });
    expect(result.questions).toEqual([]);
    expect(result.cacheHits).toBe(0);
    expect(result.coverage.covered).toEqual([]);
    expect(original).not.toHaveProperty("objectiveIds");
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not reuse a saved question whose objective tag is clearly outside its topic", async () => {
    const storage = pool();
    storage.ready.mockResolvedValueOnce([{
      stem: "A patient sustains a penetrating injury to the forearm and cannot oppose the thumb. Which hand finding is most likely?",
      choices: { A: "Thenar weakness", B: "Foot drop", C: "Ptosis", D: "Loss of knee extension" },
      correct: "A",
      explanation: "A median nerve lesion affects thenar motor function and thumb opposition.",
      objectiveIds: ["aa-objective"],
      poolId: "mislinked",
      lectureId: "l1",
    }]);
    const result = await generateExamQuestions({
      ...args,
      allocation: { l1: 1 },
      objectivesByLecture: { l1: [{ id: "aa-objective", objective: "Analyze deficiencies in amino acid metabolic pathways associated with inborn errors of metabolism" }] },
    }, { pool: storage, savedOnly: true });
    expect(result.questions).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
  it("withholds old cached reasoning claims from a new saved-only exam", async () => {
    const storage = pool();
    storage.ready.mockResolvedValue([{ ...q("Old review"), reasoningAudit: { status: "verified", version: 1 } }]);
    const result = await generateExamQuestions({ ...args, allocation: { l1: 1 } }, { pool: storage, savedOnly: true });
    expect(result.cacheHits).toBe(0);
    expect(result.questions).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects repeated and overgenerated questions across workers", async () => {
    generate.mockResolvedValue({ questions: [q("Identical"), q("Identical")] });
    const result = await generateExamQuestions({ ...args, allocation: { l1: 1, l2: 1 } });
    expect(result.questions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
  it("stops queued generation after a timeout instead of multiplying retries", async () => {
    vi.useFakeTimers(); generate.mockImplementation(() => new Promise(() => {}));
    const result = generateExamQuestions(args, { requestTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    expect((await result).errors).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });
  it("recognizes older truncated quiz history", () => {
    const stem = "A long clinical vignette containing enough information to identify the original question and its clinical context.";
    expect(alreadyUsed(q(stem), [{ stem: stem.slice(0, 100) }])).toBe(true);
  });
});

it('withholds fresh generated items missing the current review before saving or exposing them',async()=>{
 const storage=pool();const onQuestionReady=vi.fn();
 const unreviewed={...q('Unreviewed generated item'),qualityAudit:undefined};
 generate.mockResolvedValue({questions:[unreviewed]});
 const result=await generateExamQuestions({...args,allocation:{l1:1}},{pool:storage,onQuestionReady});
 expect(result.questions).toEqual([]);expect(result.errors).toHaveLength(1);
 expect(storage.save).not.toHaveBeenCalled();expect(onQuestionReady).not.toHaveBeenCalled();
});
it('does not give fresh untagged questions sole-objective credit without reviewed ownership',async()=>{
 const storage=pool();generate.mockResolvedValue({questions:[q('A fresh but untagged item')]});
 const result=await generateExamQuestions({...args,allocation:{l1:1},objectivesByLecture:{l1:[{id:'sole',objective:'Explain a specific relationship'}]}},{pool:storage});
 expect(result.questions).toEqual([]);expect(storage.save).not.toHaveBeenCalled();
});

it('passes shared cancellation to separately configured review and repair adapters',async()=>{
 const controller=new AbortController();const signals=[];
 const transport=vi.fn(async(...params)=>{
  const signal=params[6].signal;signals.push(signal);
  return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 });
 generate.mockImplementation(async(_args,deps)=>{
  const review=deps.reviewAIJSON('Independent audit','review',{},100,undefined,undefined,{});
  const repair=deps.repairAIJSON('Repair','repair',{},100,undefined,undefined,{});
  controller.abort(new Error('Preparation cancelled'));
  await Promise.all([review,repair]);return {questions:[]};
 });
 const result=await generateExamQuestions({...args,allocation:{l1:1}},{signal:controller.signal,reviewAIJSON:transport,repairAIJSON:transport});
 expect(signals).toHaveLength(2);expect(signals.every(s=>s.aborted)).toBe(true);
 expect(result.questions).toEqual([]);expect(result.errors).toHaveLength(1);
});
it('gives later review calls only the remaining preparation budget',async()=>{
 vi.useFakeTimers();const options=[];
 const transport=vi.fn(async(...params)=>{options.push(params[6]);return {};});
 generate.mockImplementation(async(_args,deps)=>{
  await deps.callAIJSON('Writer','draft',{},100,undefined,undefined,{});
  await new Promise(resolve=>setTimeout(resolve,60));
  await deps.reviewAIJSON('Independent solve','solve',{},100,undefined,undefined,{});
  return {error:"Test batch ended",questions:[]};
 });
 const pending=generateExamQuestions({...args,allocation:{l1:1}},{callAIJSON:transport,reviewAIJSON:transport,requestTimeoutMs:100});
 await vi.advanceTimersByTimeAsync(101);await pending;
 expect(options[0].timeoutMs).toBe(100);expect(options[1].timeoutMs).toBe(40);
 expect(options[1].bridgeTimeoutMs).toBe(40);
});

const ownedQuestion = (stem, id, order = 'second-order') => {
 const question = q(stem);
 return {...question,choices:{A:`Answer ${id}`,B:"Alternative"},objectiveIds:[id],orderLevel:order,
  qualityAudit:{...question.qualityAudit,semanticObjectiveAlignment:true,objectiveId:id},
  reasoningAudit:{...question.reasoningAudit,orderLevel:order}};
};
it('keeps whole-set coverage across three small generation batches',async()=>{
 const objectives=Array.from({length:9},(_,i)=>({id:`o${i}`,objective:`Explain relationship number ${i}`}));
 generate.mockImplementation(async config=>({questions:config.objectiveAllocation.flatMap(target=>Array.from({length:target._targetQuestionCount},(_,i)=>({...ownedQuestion(`UniqueRoute${target.id} ExclusiveScenario${target.id} Variant${i}`,target.id),sourceConceptKeys:[`concept-${target.id}`]})))}));
 const result=await generateExamQuestions({...args,allocation:{l1:9},objectivesByLecture:{l1:objectives}});
 expect(result.questions).toHaveLength(9);
 expect(new Set(result.questions.flatMap(question=>question.objectiveIds)).size).toBe(9);
 expect(generate).toHaveBeenCalledTimes(3);
 expect(generate.mock.calls.map(([config])=>config.objectiveAllocation.map(target=>target.id))).toEqual([['o0','o1','o2'],['o3','o4','o5'],['o6','o7','o8']]);
 expect(generate.mock.calls[1][0].conceptCoverageQuestions).toHaveLength(3);
 expect(generate.mock.calls[2][0].conceptCoverageQuestions).toHaveLength(6);
});
it('does not fill the whole set from cached questions for an already-filled objective',async()=>{
 const storage=pool();
 storage.ready.mockResolvedValue([ownedQuestion('Stored first relationship','o0'),ownedQuestion('Another stored first relationship','o0')]);
 generate.mockResolvedValue({questions:[ownedQuestion('Fresh second relationship','o1')]});
 const result=await generateExamQuestions({...args,allocation:{l1:2},objectivesByLecture:{l1:[{id:'o0',objective:'Explain relationship zero'},{id:'o1',objective:'Explain relationship one'}]}},{pool:storage});
 expect(result.cacheHits).toBe(1);
 expect(result.questions.flatMap(question=>question.objectiveIds)).toEqual(['o0','o1']);
 expect(generate.mock.calls[0][0].objectiveAllocation.map(target=>target.id)).toEqual(['o1']);
});
it('requires the confidence-earned third-order target for new and saved exam questions',async()=>{
 const storage=pool();storage.ready.mockResolvedValue([ownedQuestion('Stored lower-order question','o')]);
 const evidenceModel={objectives:{o:{attempts:1,correct:1,recent:[true],lastFreshAnswer:{correct:true,confidence:5,reasoningVerified:true,orderLevel:'second-order'}}}};
 generate.mockImplementation(async config=>({questions:[ownedQuestion('Fresh harder question','o',config.objectiveAllocation[0]._targetOrder)]}));
 const result=await generateExamQuestions({...args,allocation:{l1:1},objectivesByLecture:{l1:[{id:'o',objective:'Predict downstream consequences of altering a regulatory pathway'}]}},{pool:storage,evidenceModel});
 expect(result.cacheHits).toBe(0);
 expect(generate.mock.calls[0][0].objectiveAllocation[0]._targetOrder).toBe('third-order');
 expect(result.questions[0].orderLevel).toBe('third-order');
});
it('does not accept a lower-order generated substitute for the current target',async()=>{
 const storage=pool();
 const evidenceModel={objectives:{o:{attempts:1,correct:1,recent:[true],lastFreshAnswer:{correct:true,confidence:5,reasoningVerified:true,orderLevel:'second-order'}}}};
 generate.mockResolvedValue({questions:[ownedQuestion('Lower-order substitute','o')]});
 const result=await generateExamQuestions({...args,allocation:{l1:1},objectivesByLecture:{l1:[{id:'o',objective:'Predict downstream consequences of altering a regulatory pathway'}]}},{pool:storage,evidenceModel});
 expect(result.questions).toEqual([]);expect(storage.save).not.toHaveBeenCalled();
 expect(result.errors[0].message).toContain('reasoning-level requirements');
});
it.each([false,true])('limits repeated answer concepts in generated and saved sets (saved-only %s)',async savedOnly=>{
 const storage=pool();let serial=0;
 const candidates=()=>Array.from({length:5},()=>ownedQuestion(`UniqueScenario${serial++}`,'o'));
 if(savedOnly)storage.ready.mockResolvedValue(candidates());
 else generate.mockImplementation(async()=>({questions:candidates()}));
 const result=await generateExamQuestions({...args,allocation:{l1:5},objectivesByLecture:{l1:[{id:'o',objective:'Explain a relationship'}]}},{pool:storage,savedOnly});
 expect(result.questions).toHaveLength(2);
 expect(result.errors).toHaveLength(1);
 if(savedOnly)expect(generate).not.toHaveBeenCalled();
});
it('does not reuse a reserve explicitly assigned to another lecture',async()=>{
 const storage=pool();storage.ready.mockResolvedValue([{...ownedQuestion('Wrong lecture reserve','o'),lectureId:'l2'}]);
 const result=await generateExamQuestions({...args,allocation:{l1:1},objectivesByLecture:{l1:[{id:'o',objective:'Explain a relationship'}]}},{pool:storage,savedOnly:true});
 expect(result.questions).toEqual([]);expect(result.cacheHits).toBe(0);
});
