import {it,expect,vi} from 'vitest';
const complete=vi.hoisted(()=>vi.fn());
vi.mock('../llmBridge.js',()=>({bridgeComplete:complete,parseBridgeJSON:JSON.parse}));
import {createCurriculumReviewer} from './semanticObjectiveMapping.js';
it('uses the approved Codex route without silently falling back and enforces a per-batch budget',async()=>{
 complete.mockImplementation(async request=>{request.onUsage({costUsd:0.009});return '{"decision":"unresolved"}';});
 const review=createCurriculumReviewer({budgetUsd:0.025});
 await review('system','prompt');
 await review('system','prompt');
 await expect(review('system','prompt')).rejects.toThrow('processing budget');
 expect(complete).toHaveBeenCalledTimes(2);
 for(const [request] of complete.mock.calls)expect(request).toMatchObject({backend:'codex',backendOnly:true,modelTier:'quality'});
});

it('preserves a provider failure instead of downgrading to another backend',async()=>{
 complete.mockRejectedValueOnce(Error('Codex usage limit reached'));
 await expect(createCurriculumReviewer()('system','prompt')).rejects.toThrow('Codex usage limit reached');
 expect(complete.mock.calls.at(-1)[0]).toMatchObject({backend:'codex',backendOnly:true});
});
