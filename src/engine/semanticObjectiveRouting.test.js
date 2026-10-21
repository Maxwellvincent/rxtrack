import {it,expect,vi} from 'vitest';
const complete=vi.hoisted(()=>vi.fn());
vi.mock('../llmBridge.js',()=>({bridgeComplete:complete,parseBridgeJSON:JSON.parse}));
import {createCurriculumReviewer} from './semanticObjectiveMapping.js';
it('uses only the approved quality bridge and enforces a per-batch budget',async()=>{
 complete.mockImplementation(async request=>{request.onUsage({costUsd:0.009});return '{"decision":"unresolved"}';});
 const review=createCurriculumReviewer({budgetUsd:0.025});
 await review('system','prompt');
 await review('system','prompt');
 await expect(review('system','prompt')).rejects.toThrow('processing budget');
 expect(complete).toHaveBeenCalledTimes(2);
 for(const [request] of complete.mock.calls)expect(request).toMatchObject({backend:'ollama-cloud',backendOnly:true,modelTier:'quality'});
});
