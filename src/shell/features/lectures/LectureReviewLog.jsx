import { useRef, useState } from 'react';
import * as completionStore from '../../../stores/completion.js';
import * as questionStats from '../../../stores/lectureQuestionStats.js';
import { useStoreResource } from '../../hooks/useStoreResource.js';
import { completionKey } from '../../logic/completionLog.js';
import { lectureReviewStats } from './lectureReviewStats.js';

export function LectureReviewLog({ userId, lectureId, blockId, logActivity }) {
  const completion = useStoreResource(completionStore, userId);
  const questions = useStoreResource(questionStats, userId);
  const [minutes, setMinutes] = useState('');
  const [startedAt, setStartedAt] = useState(null);
  const [notice, setNotice] = useState('');
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const stats = lectureReviewStats(completion.data?.[completionKey(lectureId, blockId)]);
  const answered = questions.data?.[lectureId]?.answered || 0;
  const correct = questions.data?.[lectureId]?.correct || 0;
  const save = async () => {
    if (savingRef.current || completion.loading) return;
    const duration = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60000)) : minutes === '' ? null : Number(minutes);
    if (duration !== null && (!Number.isFinite(duration) || duration <= 0 || duration > 1440)) { setNotice('Enter minutes between 1 and 1440.'); return; }
    savingRef.current = true; setSaving(true);
    try {
      const entry = await logActivity?.({ lectureId, activityType: 'review', reviewKind: 'powerpoint', durationMinutes: duration, note: 'PowerPoint review' });
      if (!entry) throw new Error('Could not record this review.');
      setStartedAt(null); setMinutes(''); setNotice('Review recorded. Cloud sync may be pending when offline.');
    } catch (error) { setNotice(error.message); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <section className="my-4 rounded-lg border border-border bg-panel px-4 py-3" aria-label="Lecture review history">
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span><strong>{stats.count}</strong> PowerPoint reviews · <strong>{answered}</strong> questions answered{answered > 0 ? ` · ${Math.round(correct / answered * 100)}% correct` : ''}</span>
      <span className="text-text-3">{stats.lastReview ? `Slides last reviewed ${stats.lastReview.slice(0, 10)}` : 'Slides not yet reviewed'}</span>
    </div>
    <details className="mt-2 text-sm"><summary className="cursor-pointer text-accent-text">Log PowerPoint review & history</summary>
      <p className="my-2 text-xs text-text-3">Log a completed slide review or start the clock while reviewing. A slide review records exposure; it does not establish objective mastery.</p>
      <div className="flex flex-wrap items-center gap-3">
        {!startedAt && <><label>Minutes (optional) <input aria-label="Review minutes" type="number" min="1" max="1440" value={minutes} onChange={event => setMinutes(event.target.value)} className="ml-1 w-20 rounded border border-border bg-bg px-2 py-1" /></label><button type="button" className="underline" onClick={() => { setStartedAt(Date.now()); setNotice('Review clock running. Finish when your slide review is complete.'); }}>Start review clock</button></>}
        <button type="button" className="rounded bg-accent px-3 py-2 text-white" disabled={saving || completion.loading || !logActivity} onClick={save}>{startedAt ? 'Finish & log review' : 'Log completed review'}</button>
        {startedAt && <button type="button" className="underline" onClick={() => { setStartedAt(null); setNotice('Clock discarded; no review logged.'); }}>Discard clock</button>}
      </div>
      {completion.loading && <p className="mt-2 text-xs">Loading review history before adding a new entry…</p>}
      {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
      {completion.error && <p className="mt-2 text-xs text-bad">Cloud connection interrupted. Showing available saved history.</p>}
      <p className="mt-3 text-xs text-text-3">{stats.minutes} logged minutes · {correct} correct / {answered} answered</p>
      <ul className="mt-2 max-h-40 overflow-auto text-xs">{stats.reviews.map((review, index) => <li key={review.id || index} className="py-1">{review.date?.slice(0, 10)} · PowerPoint review{review.durationMinutes ? ` · ${review.durationMinutes} min` : ''}</li>)}</ul>
    </details>
  </section>;
}
