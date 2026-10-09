// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect, vi } from 'vitest';
vi.mock('../../hooks/useStoreResource.js', () => ({ useStoreResource: store => ({ data: store.key === 'rxt-completion' ? {} : { l: { answered: 8, correct: 6 } }, loading: false }) }));
import { LectureReviewLog } from './LectureReviewLog.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('records one completed PowerPoint review with an optional duration and displays lecture answers', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  const log = vi.fn(() => ({ activityLog: [] }));
  act(() => root.render(<LectureReviewLog userId="u" blockId="b" lectureId="l" logActivity={log} />));
  expect(host.textContent).toContain('8 questions answered');
  expect(host.textContent).toContain('75% correct');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Log completed review').click());
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ lectureId: 'l', activityType: 'review', reviewKind: 'powerpoint', durationMinutes: null }));
  expect(host.textContent).toContain('Review recorded');
  act(() => root.unmount());
});

it('clocks a completed review and discards an unfinished clock without logging', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  const log = vi.fn(() => ({ activityLog: [] }));
  const now = vi.spyOn(Date, 'now').mockReturnValue(100000);
  act(() => root.render(<LectureReviewLog userId="u" blockId="b" lectureId="l" logActivity={log} />));
  const click = text => [...host.querySelectorAll('button')].find(button => button.textContent === text).click();
  act(() => click('Start review clock'));
  now.mockReturnValue(220000);
  await act(async () => click('Finish & log review'));
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 2, reviewKind: 'powerpoint' }));
  act(() => click('Start review clock'));
  act(() => click('Discard clock'));
  expect(log).toHaveBeenCalledTimes(1);
  act(() => root.unmount()); now.mockRestore();
});
