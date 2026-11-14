import {beforeEach,it,expect,vi} from 'vitest';
const complete=vi.hoisted(()=>vi.fn());
vi.mock('../llmBridge.js',()=>({bridgeComplete:complete,parseBridgeJSON:JSON.parse}));
import {createCurriculumReviewer} from './semanticObjectiveMapping.js';
beforeEach(()=>complete.mockReset());
it('uses Ollama Cloud quality without consuming Codex and enforces a per-batch budget',async()=>{
 complete.mockImplementation(async request=>{request?.onUsage?.({costUsd:0.009});return '{"decision":"unresolved"}';});
 const review=createCurriculumReviewer({budgetUsd:0.025});
 await review('system','prompt');
 await review('system','prompt');
 await expect(review('system','prompt')).rejects.toThrow('processing budget');
 expect(complete).toHaveBeenCalledTimes(2);
 for(const [request] of complete.mock.calls)expect(request).toMatchObject({backend:'ollama-cloud',backendOnly:true,modelTier:'quality'});
});

it('falls from DeepSeek quality to Kimi escalation without touching Codex',async()=>{
 complete.mockRejectedValueOnce(Error('quality capacity reached')).mockResolvedValueOnce('{"decision":"unresolved"}');
 await expect(createCurriculumReviewer()('system','prompt')).resolves.toEqual({decision:'unresolved'});
 expect(complete.mock.calls.map(([request])=>request.modelTier)).toEqual(['quality','escalation']);
 expect(complete.mock.calls.every(([request])=>request.backend==='ollama-cloud' && request.backendOnly)).toBe(true);
});
