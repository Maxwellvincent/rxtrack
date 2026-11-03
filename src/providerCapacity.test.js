import {it,expect} from 'vitest';
import {capacityKind,capacityError,retryAfterMs} from './providerCapacity.js';
it('distinguishes provider capacity from offline and malformed content',()=>{
 expect(capacityKind('bridge 502 all backends failed ollama-cloud HTTP 429')).toBe('rate-limit');
 expect(capacityKind('You’ve hit your usage limit')).toBe('usage-limit');
 expect(capacityKind('invalid JSON')).toBeNull();
 expect(capacityKind('rate-limiting enzyme question lacks evidence')).toBeNull();
 expect(capacityKind('unseen objective quota not met')).toBeNull();
 expect(capacityKind('provider quota exceeded')).toBe('usage-limit');expect(capacityKind('network offline')).toBeNull();
 expect(capacityError('ollama-cloud','rate-limit').message).toContain('Automatic retries are paused');
});
it('honors retry-after without inventing a provider reset time',()=>{
 expect(retryAfterMs('120')).toBe(120000);
 expect(retryAfterMs('Thu, 01 Jan 1970 00:02:00 GMT',60000)).toBe(60000);
 expect(retryAfterMs(null)).toBe(60000);
});
