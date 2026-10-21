import {it,expect,vi} from 'vitest';
const call=vi.hoisted(()=>vi.fn());
vi.mock('../aiClient.js',()=>({callAIJSON:call}));
import {reviewCurriculumMapping} from './semanticObjectiveMapping.js';
it('uses only explicit bridge backends and cools down a rate-limited subscription',async()=>{
 call.mockRejectedValueOnce(new Error('429 Too Many Requests')).mockResolvedValue({decision:'unresolved'});
 await reviewCurriculumMapping('system','prompt');
 await reviewCurriculumMapping('system','prompt');
 expect(call).toHaveBeenCalledTimes(3);
 expect(call.mock.calls.map(args=>args[6].bridgeBackend)).toEqual(['codex','ollama','ollama']);
 for(const args of call.mock.calls)expect(args[6]).toMatchObject({bridgeOnly:true,bridgeBackendOnly:true});
});
