import { it, expect } from 'vitest';
import { lectureReviewStats } from './lectureReviewStats.js';
import { appendActivity, completionKey } from '../../logic/completionLog.js';
it('tracks explicit slide reviews separately from generic reviews and question practice', () => {
  let store = {};
  for (const activity of [{ activityType: 'review', reviewKind: 'powerpoint', durationMinutes: 20 }, { activityType: 'questions' }, { activityType: 'review' }, { activityType: 'review', reviewKind: 'powerpoint', durationMinutes: 30 }]) {
    store = appendActivity(store, { lectureId: 'l', blockId: 'b', date: '2026-10-09', ...activity }).store;
  }
  expect(lectureReviewStats(store[completionKey('l', 'b')])).toMatchObject({ count: 2, minutes: 50, lastReview: '2026-10-09' });
  expect(store[completionKey('l', 'b')].activityLog).toHaveLength(4);
  expect(lectureReviewStats(store[completionKey('other', 'b')])).toMatchObject({ count: 0, minutes: 0 });
});
