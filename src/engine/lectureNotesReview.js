import { DAY, enrollLectureModel } from './modelRetrieval.js';

/** Explicit completion of the learner's own notes, not AI reference generation. */
export function recordLectureNotes(data, input, now, eventId) {
  const enrolled = enrollLectureModel(data, input, now);
  const model = Object.values(enrolled.models).find(m => m.lectureId === input.lectureId && m.blockId === input.blockId);
  if ((model.notesCompletions || []).some(event => event.id === eventId)) return enrolled;
  const reference = String(input.reference || '').trim().slice(0,12000);
  const next = { ...model,
    ...(reference ? { reference } : {}),
    notesCompletedAt: now,
    notesCompletions: [...(model.notesCompletions || []), { id:eventId, at:now }].slice(-100),
    // A notes update isn't proof of successful retrieval. Keep existing review history.
    nextReviewAt: model.nextReviewAt == null ? now + DAY : Math.min(model.nextReviewAt, now + DAY),
    status: model.status === 'Released' ? 'New' : model.status,
  };
  return { ...enrolled, models: { ...enrolled.models, [model.id]: next } };
}

/** Practical suggestions based on observed coverage; not a claim about learning style. */
export function lectureNotesRecommendation(rows = [], model = {}, evidence = {}, now = Date.now()) {
  const weak = rows.filter(row => row.attempts >= 2 && row.correct / row.attempts < 0.6)
    .sort((a,b) => a.correct/a.attempts-b.correct/b.attempts || b.attempts-a.attempts);
  const untested = rows.filter(row => !row.attempts);
  const developing = rows.filter(row => row.attempts && !row.ready && !weak.includes(row));
  const ready = rows.filter(row => row.ready);
  const attempts = rows.reduce((sum,row)=>sum+row.attempts,0);
  const correct = rows.reduce((sum,row)=>sum+row.correct,0);
  const targets = (weak.length ? weak : untested.length ? untested : developing.length ? developing : rows).slice(0,2);
  const topic = targets.map(row=>row.text || row.code).join('; ');
  const pathway = /pathway|course|branch|innervat|nerv|flow|transport|circuit|reflex|signal/i.test(topic);
  const task = weak.length
    ? pathway ? 'Redraw one weak pathway from memory' : 'Explain and repair one confusing connection'
    : untested.length ? 'Explain two untested objectives from your notes'
    : developing.length ? 'Reconstruct the model, then test one connection'
    : 'Brief closed-book check of your notes';
  const instruction = weak.length
    ? pathway ? 'With your notes closed, draw the route and label what each connection does. Open your notes, correct one missing link, then explain what would change if that link failed.'
      : 'Write what you expected and what actually happens. Connect them with a because statement, check your notes, and correct the missing relationship.'
    : untested.length ? 'Use your notes to explain what each objective asks you to understand. Then try a fresh question; untested means coverage is unknown, not that you failed.'
    : 'Close your notes and reconstruct the main relationships. Check one uncertainty, then use a fresh question to see whether you can apply it.';
  const baseline = Math.max(Number(model.lastReviewedAt)||0, Number(model.notesCompletedAt || model.confirmedCreatedAt || model.createdAt)||0);
  const newMiss = weak.some(row => {
    const item = evidence.objectives?.[row.id];
    const seen = typeof item?.lastSeen === 'number' ? item.lastSeen : Date.parse(item?.lastSeen || '');
    return seen > baseline && seen <= now && item.recent?.at(-1) === false;
  });
  return { task, instruction, targets, weak:weak.length, untested:untested.length, developing:developing.length, ready:ready.length,
    total:rows.length, attempts, accuracy:attempts ? Math.round(100*correct/attempts) : null, newMiss,
    summary:`${weak.length} low-scoring · ${untested.length} untested · ${developing.length} developing · ${ready.length} ready` };
}

export function modelWithNotesEvidence(model, rows, evidence, now, useQuestionEvidence = true) {
  const advice = lectureNotesRecommendation(rows,model,evidence,now);
  return { ...model, notesAdvice:advice,
    ...(useQuestionEvidence && advice.newMiss ? { nextReviewAt:Math.min(model.nextReviewAt ?? now,now), priority:Math.max(model.priority||1,2), status:'Shaky' } : {}) };
}
