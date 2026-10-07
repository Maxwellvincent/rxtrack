import { it, expect, vi } from 'vitest';
import { withQuestionAIRouting } from './mcq.js';
it('prefers Ollama while preserving deadline, strict errors and explicit overrides', async () => {
 const call=vi.fn().mockResolvedValue({questions:[]});
 const wrapped=withQuestionAIRouting(call);
 await wrapped('system','prompt',{},8000,undefined,undefined,{throwOnError:true,timeoutMs:5000});
 expect(call.mock.calls[0][6]).toEqual({bridgeBackend:'ollama',throwOnError:true,timeoutMs:5000});
 await wrapped('system','prompt',{},4000,undefined,undefined,{bridgeBackend:'codex'});
 expect(call.mock.calls[1][6].bridgeBackend).toBe('codex');
 expect(withQuestionAIRouting(undefined)).toBeUndefined();
});
