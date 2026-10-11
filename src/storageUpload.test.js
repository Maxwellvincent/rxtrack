import { it, expect, vi } from 'vitest';
import { awaitStorageUpload, archiveQuestionSource } from './storageUpload.js';
it('cancels an upload that exceeds the bound rather than letting Firebase retry indefinitely', async () => {
  vi.useFakeTimers();
  const task = new Promise(() => {}); task.cancel = vi.fn();
  const result = awaitStorageUpload(task, 100);
  const rejected = expect(result).rejects.toMatchObject({ code: 'storage/upload-timeout' });
  await vi.advanceTimersByTimeAsync(100);
  await rejected; expect(task.cancel).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
it('keeps archiving failure optional and reports missing source navigation honestly', async () => {
  const warning = vi.fn();
  expect(await archiveQuestionSource(async () => { throw Object.assign(new Error('retry failed'), {code:'storage/retry-limit-exceeded'}); }, warning)).toBeNull();
  expect(warning.mock.calls[0][0]).toContain('Original PDF not archived');
  expect(warning.mock.calls[0][0]).toContain('storage/retry-limit-exceeded');
  expect(await archiveQuestionSource(async () => 'exam-sources/u/source.pdf', warning)).toBe('exam-sources/u/source.pdf');
});
it('propagates normal upload failures and clears the deadline after success', async () => {
  expect(await awaitStorageUpload(Promise.resolve('saved'))).toBe('saved');
  await expect(awaitStorageUpload(Promise.reject(new Error('denied')))).rejects.toThrow('denied');
});

import { uploadSchoolFile } from './storageUpload.js';
const schoolOptions = () => ({ auth: { authStateReady: async () => {}, currentUser: {uid:'test',getIdToken:vi.fn(async ()=>'synthetic-token')} }, userId:'test',bucket:'test-bucket',path:'exam-sources/test/source.pdf',blob:new Blob(['synthetic'],{type:'application/pdf'}) });
it('uses a single authenticated multipart request and confirms its destination', async () => {
  const opts=schoolOptions();
  opts.fetchImpl=vi.fn(async()=>({ok:true,json:async()=>({name:opts.path,bucket:opts.bucket})}));
  await uploadSchoolFile(opts);
  expect(opts.auth.currentUser.getIdToken).toHaveBeenCalledWith(true);
  expect(opts.fetchImpl).toHaveBeenCalledTimes(1);
  const [url,request]=opts.fetchImpl.mock.calls[0];
  expect(url).toContain('name=exam-sources%2Ftest%2Fsource.pdf');
  expect(request.headers.Authorization).toBe('Firebase synthetic-token');
  expect(await request.body.text()).toContain('synthetic');
});
it('refuses a different user before transmitting a file', async () => {
  const opts=schoolOptions();opts.userId='other';opts.fetchImpl=vi.fn();
  await expect(uploadSchoolFile(opts)).rejects.toMatchObject({code:'storage/unauthenticated'});
  expect(opts.fetchImpl).not.toHaveBeenCalled();
});
it('reports permissions and network failures immediately without retries', async () => {
  for (const [response,code] of [[{ok:false,status:403},'storage/unauthorized'],[{ok:false,status:404},'storage/bucket-not-found']]) {
    const opts=schoolOptions();opts.fetchImpl=vi.fn(async()=>response);
    await expect(uploadSchoolFile(opts)).rejects.toMatchObject({code});
    expect(opts.fetchImpl).toHaveBeenCalledTimes(1);
  }
  await expect(uploadSchoolFile({...schoolOptions(),fetchImpl:async()=>{throw new TypeError('fetch failed')}})).rejects.toMatchObject({code:'storage/network-error'});
});
it('rejects an upload response for an unexpected object', async () => {
  await expect(uploadSchoolFile({...schoolOptions(),fetchImpl:async()=>({ok:true,json:async()=>({name:'other',bucket:'test-bucket'})})})).rejects.toMatchObject({code:'storage/invalid-response'});
});
it('aborts the request at the deadline', async () => {
  vi.useFakeTimers();
  const opts=schoolOptions();opts.timeoutMs=100;let signal;
  opts.fetchImpl=async(_,request)=>{signal=request.signal;return new Promise(()=>{});};
  const rejected=expect(uploadSchoolFile(opts)).rejects.toMatchObject({code:'storage/upload-timeout'});
  await vi.advanceTimersByTimeAsync(100);await rejected;
  expect(signal.aborted).toBe(true);vi.useRealTimers();
});
