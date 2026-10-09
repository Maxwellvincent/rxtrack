import { it, expect, vi } from 'vitest';
import { readPreference, writePreference, storageReport, releaseConfirmedCloudCopy } from './browserStorage.js';
it('keeps a preference usable for this session when browser writes fail', () => {
  vi.stubGlobal('localStorage', {getItem:()=>null,setItem:()=>{throw new Error('QuotaExceededError')}});
  expect(writePreference('day-test','review')).toBe(false);
  expect(readPreference('day-test')).toBe('review');
  vi.unstubAllGlobals();
});
it('removes only byte-identical confirmed copies and preserves divergent or missing data', () => {
  const data = new Map([['same',JSON.stringify({a:1})],['different',JSON.stringify({a:2})]]);
  const storage={getItem:k=>data.get(k)??null,removeItem:k=>data.delete(k)};
  expect(releaseConfirmedCloudCopy('same',{a:1},storage)).toBe(true);
  expect(releaseConfirmedCloudCopy('different',{a:1},storage)).toBe(false);
  expect(releaseConfirmedCloudCopy('missing',{a:1},storage)).toBe(false);
  expect(data.has('different')).toBe(true);
});
it('reports largest RxTrack records without reading out their contents or account IDs', () => {
  const entries=[['rxt:private-user:rxt-question-banks','long value'],['rxt-mode','x'],['other','bigger unrelated data']];
  const storage={length:entries.length,key:i=>entries[i][0],getItem:k=>entries.find(e=>e[0]===k)?.[1]};
  const report=storageReport(storage);
  expect(report.entries).toHaveLength(2);
  expect(report.entries[0].key).toBe('rxt-question-banks');
  expect(JSON.stringify(report)).not.toContain('private-user');
  expect(JSON.stringify(report)).not.toContain('long value');
});
