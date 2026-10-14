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
