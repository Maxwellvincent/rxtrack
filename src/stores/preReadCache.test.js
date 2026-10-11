import { afterEach, expect, it, vi } from 'vitest';
import { boundCache, read, write } from './preReadCache.js';
afterEach(() => vi.unstubAllGlobals());
it('bounds regenerable outputs by count and size', () => {
  expect(Object.keys(boundCache(Object.fromEntries(Array.from({length:30},(_,i)=>[i,{generatedAt:String(i).padStart(2,'0'),payload:'x'}]))))).toHaveLength(20);
  expect(boundCache({large:{payload:'x'.repeat(130000)}})).toEqual({});
});
it('retains a session copy on quota failure and removes only the disposable cache', () => {
  const removeItem=vi.fn();
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:()=>{throw new DOMException('full','QuotaExceededError');},removeItem});
  const value={lecture:{generatedAt:'2026-10-11',payload:'pre-read'}};
  expect(()=>write('quota-test',value)).not.toThrow();
  expect(read('quota-test')).toEqual(value);
  expect(removeItem).toHaveBeenCalledExactlyOnceWith('rxt:quota-test:rxt-preread-cache');
});
