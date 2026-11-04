import {describe,it,expect,vi,afterEach} from 'vitest';
import * as sourceUse from '../stores/sourceUse.js';
import {generateMcqs,generateFromAtoms,auditGeneratedQuestions} from './mcq.js';
import {prepareObjectiveQuiz} from '../shell/features/objectives/quizLaunch.js';
afterEach(()=>vi.restoreAllMocks());
describe('final source reservation boundary',()=>{
 it.each([generateMcqs,generateFromAtoms])('fails closed when exposure persistence fails before model invocation',async generate=>{
  vi.spyOn(sourceUse,'context').mockRejectedValue(new Error('Registry unavailable'));
  const callAIJSON=vi.fn();
  const result=await generate({userId:'test',examples:[{stem:'Private reserved example',_trackSourceUse:true}]},{callAIJSON});
  expect(callAIJSON).not.toHaveBeenCalled();
  expect(result.questions).toEqual([]);
  expect(result.error).toContain('Source exposure tracking failed');
  expect(result.failureKind).toBe('source_tracking');
 });
 it('removes a newly reserved captured example and rebuilds derived style before calling the model',async()=>{
  vi.spyOn(sourceUse,'context').mockResolvedValue([]);
  const callAIJSON=vi.fn().mockResolvedValue({questions:[]});
  await generateMcqs({examples:[{stem:'SECRET_SOURCE_SENTENCE',choices:{A:'Secret',B:'Other'},correct:'A',_trackSourceUse:true}],styleProfile:{secret:'SECRET_SOURCE_SENTENCE'},lectureText:'The dorsal column pathway carries vibration and position sensation ipsilaterally in the spinal cord before crossing in the medulla. A spinal lesion therefore causes ipsilateral sensory loss.',count:1},{callAIJSON,skipQuestionAudit:true});
  expect(callAIJSON).toHaveBeenCalled();
  expect(JSON.stringify(callAIJSON.mock.calls)).not.toContain('SECRET_SOURCE_SENTENCE');
 });
});

it('stops preparation at a storage failure instead of refilling or blaming quality',async()=>{
 vi.spyOn(sourceUse,'context').mockRejectedValue(new Error('failed-precondition'));
 const callAIJSON=vi.fn();
 const result=await prepareObjectiveQuiz({questionCount:20,userId:'u',lectureText:'Lecture evidence about peripheral nerve function. '.repeat(20),
  exemplars:[{stem:'Which structure transmits this sensory signal?',choices:{A:'First structure',B:'Second structure'},correct:'A',sourceFile:'Homework.pdf',sourceType:'homework',_trackSourceUse:true}]},
  {callAIJSON,continueAfterEmptyRounds:true,maxEmptyRounds:3});
 expect(callAIJSON).not.toHaveBeenCalled();
 expect(result.reason).toContain('Source exposure tracking failed: failed-precondition');
 expect(result.diagnostics.rejections.source_tracking_failure).toBe(1);
});
it('preserves a blind-review capacity error rather than labeling the question incorrect',async()=>{
 const reviewAIJSON=vi.fn().mockRejectedValue(new Error('Ollama Cloud rate limit (HTTP 429) reached'));
 const result=await auditGeneratedQuestions([{stem:'A patient loses sensory input after injury. Which structure was damaged?',choices:{A:'Sensory nerve',B:'Motor nerve',C:'Autonomic ganglion',D:'Motor cortex'},correct:'A',explanation:'Injury to the sensory nerve interrupts afferent input from the affected territory.'}],
  {requireBlindKeyCheck:true,requireReasoningAudit:true},{reviewAIJSON,skipRepair:true});
 expect(result.failureKind).toBe('review_unavailable');expect(result.error).toContain('429');
 expect(reviewAIJSON).toHaveBeenCalledTimes(2); // Codex plus the configured cloud fallback, no key-aware review afterward.
 expect(reviewAIJSON.mock.calls.every(call=>call[0].startsWith('Solve from lecture evidence'))).toBe(true);
});
