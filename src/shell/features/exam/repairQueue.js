/** Current work queue overlays historical exam performance; never rewrites scores. */
export function repairActivity(lectureId,sessions,impact={},atoms={},now=Date.now()) {
 const latestExam=Math.max(0,...sessions.filter(s=>(s.questions||[]).some(q=>q.lectureId===lectureId)).map(s=>Number(s.submittedAt)||0));
 const entry=impact[lectureId]||{};
 const day=new Date(now).toDateString();
 const recent=(entry.attempts||[]).filter(a=>a.at>latestExam&&new Date(a.at).toDateString()===day);
 const reviewed=entry.lastReviewedAt>latestExam&&new Date(entry.lastReviewedAt).toDateString()===day;
 return {workedToday:recent.length>0||reviewed,followupQuestions:recent.length,remainingRepairs:Object.values(atoms[lectureId]||{}).filter(a=>a.status==='needs-review').length};
}
