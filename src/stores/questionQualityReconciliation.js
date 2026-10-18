import { listExamSessions } from '../supabase.js';
import * as weakConcepts from './weakConcepts.js';
import { computeWeakConceptEntry } from '../shell/features/exam/finalizeLogic.js';

// Weak-area rows are derived data. Rebuild only the affected lecture from
// preserved submitted answers, making exclusion and undo equally reversible.
export async function reconcileQuestionQuality(userId, question) {
 if (!userId || !question?.lectureId) return;
 const sessions = await listExamSessions(userId, null, { status: 'submitted' });
 const blockId = question.sourceBlockId || question.blockId;
 if (!blockId) return;
 const current = weakConcepts.read(userId) || {};
 const rows = current[blockId] || [];
 const id = `exam:${blockId}:${question.lectureId}`;
 const previous = rows.find(row => row.id === id);
 const sourceSessions = sessions.filter(session => (session.questions || []).some(q => q.lectureId === question.lectureId && (q.sourceBlockId || q.blockId || session.blockId) === blockId));
 const entry = computeWeakConceptEntry({ sessions: sourceSessions, blockId, blockName: question.sourceBlockName || '', lectureId: question.lectureId, lectureLabel: question.lectureLabel || previous?.concept, existingEntry: previous, now: Date.now() });
 const nextRows = rows.filter(row => row.id !== id);
 if (entry) nextRows.push(entry);
 await weakConcepts.writeAwait(userId, { ...current, [blockId]: nextRows });
}
