import { it, expect, vi } from 'vitest';
import { withQuestionAIRouting } from './mcq.js';
it('uses Codex strictly while preserving deadlines and explicit overrides', async () => {
 const call=vi.fn().mockResolvedValue({questions:[]}); const wrapped=withQuestionAIRouting(call);
 await wrapped('system','prompt',{},8000,undefined,undefined,{throwOnError:true,timeoutMs:5000});
 expect(call.mock.calls[0][6]).toEqual({bridgeBackend:'codex',bridgeBackendOnly:true,bridgeOnly:true,throwOnError:true,timeoutMs:5000});
 await wrapped('system','prompt',{},4000,undefined,undefined,{bridgeBackend:'ollama-cloud'});
 expect(call.mock.calls[1][6].bridgeBackend).toBe('ollama-cloud');
 expect(withQuestionAIRouting(undefined)).toBeUndefined();
});
it('falls back only to Ollama Cloud on Codex usage limits', async () => {
 const call=vi.fn().mockRejectedValueOnce(new Error('Codex usage limit reached')).mockResolvedValueOnce({questions:[]});
 await withQuestionAIRouting(call)('s','p',{},3000,undefined,undefined,{timeoutMs:5000});
 expect(call.mock.calls[1][6]).toMatchObject({bridgeBackend:'ollama-cloud',bridgeBackendOnly:true,bridgeOnly:true,bridgeModelTier:'routine'});
 expect(call.mock.calls[1][6].timeoutMs).toBeLessThanOrEqual(5000);
});
it('does not switch providers for offline, content, cancellation or explicit-route failures', async () => {
 for(const [message,options] of [['network offline',{}],['invalid source content',{}],['usage limit reached',{bridgeBackend:'codex'}]]) {
  const call=vi.fn().mockRejectedValue(new Error(message));
  await expect(withQuestionAIRouting(call)('s','p',{},3000,undefined,undefined,options)).rejects.toThrow(message);
  expect(call).toHaveBeenCalledOnce();
 }
});
