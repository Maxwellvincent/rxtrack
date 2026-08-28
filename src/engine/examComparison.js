const time = v => typeof v === 'number' ? v : Date.parse(v);
const fingerprint = q => String(q.stem || '').toLowerCase().replace(/[^a-z0-9]/g,'');

export function compareSchoolResults(blockId, sessions = [], reports = []) {
  const seen = new Set(), seenSessions = new Set(), eligible = [];
  let excluded = 0;
  for (const s of [...sessions].filter(s=>s.blockId===blockId).sort((a,b)=>time(a.startedAt || a.submittedAt)-time(b.startedAt || b.submittedAt))) {
    if (!s.sessionId || seenSessions.has(s.sessionId)) continue;
    seenSessions.add(s.sessionId);
    const qs = s.questions || [], keys = qs.map(fingerprint);
    const fresh = keys.every(k=>k && !seen.has(k)) && new Set(keys).size===keys.length;
    keys.filter(Boolean).forEach(k=>seen.add(k)); // even prior untimed/expert exposure counts
    const normal = qs.every(q=>q.difficulty==='medium' && q.sourceType!=='question-bank' && q.sourceKind!=='imcq' && !/imcq/i.test(q.sourceFile || ''));
    if (s.status!=='submitted' || s.format!=='exam' || !qs.length || !fresh || !normal || !Number.isFinite(time(s.submittedAt))) { excluded++; continue; }
    const answers = new Map((s.answers || []).map(a=>[a.questionId,a.value]));
    const correct = qs.filter(q=>q.correct && answers.get(q.questionId)===q.correct).length;
    eligible.push({at:time(s.submittedAt),count:qs.length,correct});
  }
  const pairs = reports.filter(r=>r.blockId===blockId).map(r=>{
    // Exclude exam-day practice: a report date has no trustworthy exam start time.
    const end = Date.parse(r.date+'T00:00:00');
    const prior = eligible.filter(s=>s.at<end && s.at>=end-7*86400000);
    const count=prior.reduce((n,s)=>n+s.count,0), correct=prior.reduce((n,s)=>n+s.correct,0);
    return {...r,practiceCount:count,practiceAccuracy:count?correct/count:null,gap:count?r.percent-100*correct/count:null};
  });
  return {eligibleSessions:eligible.length,excluded,pairs};
}

export function validateSchoolResult(r) {
  return !!r.blockId && !!String(r.name || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') &&
    Number.isFinite(Date.parse(r.date)) && new Date(r.date).toISOString().slice(0,10)===r.date && ['exam','quiz'].includes(r.kind) &&
    typeof r.percent==='number' && Number.isFinite(r.percent) && r.percent>=0 && r.percent<=100;
}
