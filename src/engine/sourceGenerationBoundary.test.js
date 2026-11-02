import {describe,it,expect,vi,afterEach} from 'vitest';
import * as sourceUse from '../stores/sourceUse.js';
import {generateMcqs,generateFromAtoms} from './mcq.js';
afterEach(()=>vi.restoreAllMocks());
describe('final source reservation boundary',()=>{
 it.each([generateMcqs,generateFromAtoms])('fails closed when exposure persistence fails before model invocation',async generate=>{
  vi.spyOn(sourceUse,'context').mockRejectedValue(new Error('Registry unavailable'));
  const callAIJSON=vi.fn();
  const result=await generate({userId:'test',examples:[{stem:'Private reserved example',_trackSourceUse:true}]},{callAIJSON});
  expect(callAIJSON).not.toHaveBeenCalled();
  expect(result.questions).toEqual([]);
  expect(result.error).toContain('Source exposure tracking failed');
 });
 it('removes a newly reserved captured example and rebuilds derived style before calling the model',async()=>{
  vi.spyOn(sourceUse,'context').mockResolvedValue([]);
  const callAIJSON=vi.fn().mockResolvedValue({questions:[]});
  await generateMcqs({examples:[{stem:'SECRET_SOURCE_SENTENCE',choices:{A:'Secret',B:'Other'},correct:'A',_trackSourceUse:true}],styleProfile:{secret:'SECRET_SOURCE_SENTENCE'},lectureText:'The dorsal column pathway carries vibration and position sensation ipsilaterally in the spinal cord before crossing in the medulla. A spinal lesion therefore causes ipsilateral sensory loss.',count:1},{callAIJSON,skipQuestionAudit:true});
  expect(callAIJSON).toHaveBeenCalled();
  expect(JSON.stringify(callAIJSON.mock.calls)).not.toContain('SECRET_SOURCE_SENTENCE');
 });
});
