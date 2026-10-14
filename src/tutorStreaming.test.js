import { describe, it, expect } from 'vitest';
import { streamedTutorFeedback } from './llmBridge.js';
describe('public tutor streaming', () => {
  it('shows incomplete feedback without exposing private fields', () => {
    expect(streamedTutorFeedback('{"feedback":"Water moves uphill')).toBe('Water moves uphill');
    expect(streamedTutorFeedback('{"assessment":"partial","firstDivergence":"private"}')).toBe('');
  });
  it('decodes escapes and tolerates partial escapes', () => {
    expect(streamedTutorFeedback('{"feedback":"A\\nB\\"C"}')).toBe('A\nB"C');
    expect(streamedTutorFeedback('{"feedback":"A\\')).toBe('A');
  });
});

import { vi, afterEach } from 'vitest';
import { bridgeTutor, resetBridgeProbe } from './llmBridge.js';
afterEach(() => { vi.unstubAllGlobals(); resetBridgeProbe(); });
function mockStream(events) {
  vi.stubGlobal('localStorage', { getItem: () => null });
  const bytes = new TextEncoder().encode(events);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) }).mockResolvedValueOnce({
    ok: true, body: new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      controller.close();
    } }),
  }));
}
describe('tutor transport', () => {
  it('handles split events and requires a completed structured reply', async () => {
    mockStream(JSON.stringify({type:'delta',text:'{"feedback":"Hi"}'})+'\n'+JSON.stringify({type:'complete',text:'{"feedback":"Hi"}'})+'\n');
    const onDelta=vi.fn();
    await expect(bridgeTutor({sessionKey:'test',prompt:'hello',onDelta})).resolves.toEqual({feedback:'Hi'});
    expect(onDelta).toHaveBeenCalledWith('{"feedback":"Hi"}');
  });
  it('does not treat an interrupted stream as completed feedback', async () => {
    mockStream(JSON.stringify({type:'delta',text:'{"feedback":"Hi"}'})+'\n');
    await expect(bridgeTutor({sessionKey:'test',prompt:'hello'})).rejects.toThrow('disconnected');
  });
});
