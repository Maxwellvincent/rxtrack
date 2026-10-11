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
