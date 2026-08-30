export const DAY = 86400000;
export const DEFAULT_SETTINGS = { minutes: 10, cap: 4, sameDay: true, questionEvidence: true, ankiEvidence: true, weekend: false };
export function settingsFor(settings = {}) {
  return { ...DEFAULT_SETTINGS, ...settings,
    minutes: [5,10,15,20].includes(Number(settings.minutes)) ? Number(settings.minutes) : 10,
    cap: Math.max(1, Math.min(4, Number(settings.cap) || 4)) };
}
export function dayKey(at) { const d = new Date(at); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }
/** Explicit learner confirmation, not automatic enrollment of an AI-generated reference. */
export function enrollLectureModel(data, input, now) {
  if (!input.lectureId || !input.blockId) throw new Error('A saved lecture and block are required.');
  const existing=Object.values(data.models || {}).find(m=>m.lectureId===input.lectureId && m.blockId===input.blockId);
  if (existing) return data; // Preserve history and scheduling on repeated clicks/devices.
  const id=`lecture:${input.blockId}:${input.lectureId}`;
  const model=createRetrievalModel({...input,id,lecture:input.title,
    prompt:input.prompt || `Reconstruct your mental model for ${input.title} from memory. Explain the major parts, their causal connections, and what changes when one part fails.`},now,data.settings);
  return {...data,models:{...data.models,[id]:{...model,lectureId:input.lectureId,confirmedCreatedAt:now}}};
}
export function createRetrievalModel(input, now, settings = {}) {
  const title = String(input.title || '').trim().slice(0,200);
  const prompt = String(input.prompt || '').trim().slice(0,1500);
  if (!title || !prompt || !input.blockId) throw new Error('Add a title, block, and relationship-focused retrieval prompt.');
  return { id: input.id, blockId: input.blockId, lecture: String(input.lecture || '').slice(0,200), subject: String(input.subject || '').slice(0,120),
    title, prompt, reference: String(input.reference || '').slice(0,12000), tags: String(input.tags || '').slice(0,500),
    createdAt: now, lastReviewedAt: null, lastSolidAt: null, nextReviewAt: now + (settingsFor(settings).sameDay ? 0 : DAY),
    status: 'New', solidStreak: 0, priority: Math.max(1,Math.min(3,Number(input.priority)||1)),
    minutes: Math.max(2,Math.min(5,Number(input.minutes)||3)), history: [], evidence: [], };
}
export function gradeModel(model, grade, now, eventId) {
  if (!['broken','shaky','solid'].includes(grade)) throw new Error('Choose Broken, Shaky, or Solid.');
  if (model.history.some(h => h.id === eventId)) return model;
  const early = model.lastReviewedAt != null && model.nextReviewAt != null && now < model.nextReviewAt;
  let streak = model.solidStreak || 0;
  let status, nextReviewAt;
  if (grade === 'broken') { streak=0; status='Learning'; nextReviewAt=now+DAY; }
  else if (grade === 'shaky') { streak=0; status='Shaky'; nextReviewAt=now+(model.history.at(-1)?.grade==='shaky'?2:3)*DAY; }
  else if (early) { status=model.status; nextReviewAt=model.nextReviewAt; }
  else {
    streak++;
    const longTerm = model.lastSolidAt != null && now-model.lastSolidAt >= 30*DAY;
    status = streak>=4 && longTerm ? 'Released' : streak>=2 ? 'Stable' : 'Learning';
    nextReviewAt = status==='Released' ? null : now + ([7,14,30][Math.min(streak-1,2)])*DAY;
  }
  return {...model, status, solidStreak:streak, nextReviewAt, lastReviewedAt:now,
    lastSolidAt:grade==='solid' && !early ? now : model.lastSolidAt,
    history:[...model.history,{id:eventId,at:now,day:dayKey(now),grade,minutes:model.minutes,nextReviewAt,early}]};
}
export function applyModelEvidence(model, event, settings = {}) {
  const prefs=settingsFor(settings);
  const types=['question-success','question-miss','anki-again','anki-success','manual-confirmation'];
  if (!event.id || !Number.isFinite(event.at) || !types.includes(event.type)) throw new Error('Evidence needs an id, timestamp and supported type.');
  if (event.type.startsWith('question-') && !prefs.questionEvidence || event.type.startsWith('anki-') && !prefs.ankiEvidence) return model;
  if ((model.evidence || []).some(e=>e.id===event.id)) return model;
  const evidence=[...(model.evidence || []),{id:event.id,type:event.type,at:event.at,sourceId:String(event.sourceId||'').slice(0,200)}].slice(-200);
  const weak=event.type==='question-miss'||event.type==='anki-again';
  // External correct facts are partial evidence, never proof of whole-model recall.
  return {...model,evidence,...(weak ? {status:'Shaky',solidStreak:0,nextReviewAt:Math.min(model.nextReviewAt ?? event.at,event.at)} : {})};
}
export function priorityScore(model, now, examDate) {
  const weakness={New:2,Learning:4,Shaky:3,Stable:1,Released:0.5}[model.status] || 1;
  const recency=1+Math.min(3,Math.max(0,(now-(model.lastSolidAt || model.createdAt))/DAY)/14);
  const exam=Date.parse(examDate || '');
  const days=(exam-now)/DAY;
  const proximity=Number.isFinite(exam)&&days>=0 ? 1+3/(1+days) : 1;
  const recent=(model.evidence||[]).filter(e=>e.at<=now && now-e.at<=7*DAY);
  const misses=recent.filter(e=>['question-miss','anki-again'].includes(e.type)).length;
  const successes=recent.filter(e=>['question-success','anki-success','manual-confirmation'].includes(e.type)).length;
  return weakness*recency*proximity*(model.priority||1)*(1+Math.min(5,misses))/(1+Math.min(3,successes)*0.25);
}
export function selectDailyModels(models, settings, now, blockId, examDate) {
  const prefs=settingsFor(settings), today=dayKey(now);
  const done=models.flatMap(m=>(m.history||[]).filter(h=>h.day===today));
  let minutesLeft=Math.max(0,prefs.minutes-done.reduce((n,h)=>n+h.minutes,0));
  let slotsLeft=Math.max(0,prefs.cap-done.length);
  const selected=[];
  const weekend=prefs.weekend && new Date(now).getDay()===6;
  const candidates=models.filter(m=>m.blockId===blockId && m.status!=='Released' && (m.nextReviewAt<=now || weekend) && !(m.history||[]).some(h=>h.day===today))
    .sort((a,b)=>priorityScore(b,now,examDate)-priorityScore(a,now,examDate)||a.createdAt-b.createdAt||a.id.localeCompare(b.id));
  for(const model of candidates) if(slotsLeft>0 && model.minutes<=minutesLeft) { selected.push(model); minutesLeft-=model.minutes;slotsLeft--; }
  return {selected,done:done.length,spent:done.reduce((n,h)=>n+h.minutes,0),minutesLeft:Math.max(0,prefs.minutes-done.reduce((n,h)=>n+h.minutes,0)),slotsLeft:Math.max(0,prefs.cap-done.length)};
}
