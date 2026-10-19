import { allocateQuestions } from './allocation.js';
// User-supplied BPM 2 school blueprint. Blank cells are unspecified, not zero.
export const BPM_BLUEPRINTS = {
  1: { anatomy:[25,30], biochemistry:[20,25], genetics:[5,10], histology:[15,20], physiology:[25,30] },
  2: { anatomy:[15,20], biochemistry:[60,65], histology:[10,15], physiology:[10,15] },
  3: { anatomy:[45,50], neuroscience:[40,45], histology:[5,10] },
  4: { neuroscience:[65,70], behavioral:[30,35] },
  5: { behavioral:[65,70], neuroscience:[30,35] },
};
export const SUBJECT_LABELS = {anatomy:'Anatomy',biochemistry:'Biochemistry',genetics:'Genetics',histology:'Histology',physiology:'Physiology',neuroscience:'Neuroscience',behavioral:'Behavioral Science'};
const aliases={ANAT:'anatomy',ANATOMY:'anatomy',BCHM:'biochemistry',BIOC:'biochemistry',BIOCHEMISTRY:'biochemistry',GNET:'genetics',GENETICS:'genetics',HIST:'histology',HISTOLOGY:'histology',PHYS:'physiology',PHYSIOLOGY:'physiology',NEUR:'neuroscience',NEURO:'neuroscience',NEUROSCIENCE:'neuroscience',HCB:'histology',NSCI:'neuroscience',BEHS:'behavioral',BEHV:'behavioral','BEHAVIORAL SCIENCE':'behavioral','HISTOLOGY AND CELL BIOLOGY':'histology',BEHAVIORAL:'behavioral',BEHAVIOURAL:'behavioral'};
export function objectiveSubject(o={}) {
  const explicit=String(o.discipline||o.subject||'').trim().toUpperCase();
  if(aliases[explicit]) return aliases[explicit];
  const code=String(o.code||o.id||'').toUpperCase().split(/[.\s_:/-]+/);
  return code.map(token=>aliases[token]).find(Boolean)||null;
}
export function bpmObjective(o={}) {
  const code=String(o.code||o.id||'');
  const term=code.match(/(?:BPM|BMP)\s*(\d+)/i);
  return !term || Number(term[1])===2;
}
export const slotKey=(lectureId,subject)=>`${lectureId}::bpm::${subject}`;
export function readSlot(key) { const [lectureId,subject]=String(key).split('::bpm::');return {lectureId,subject:subject||null}; }
export const questionSlot=q=>q.blueprintSlot||q.lectureId;
export function subjectTargets(exam,count) {
 const weights=BPM_BLUEPRINTS[exam];if(!weights)return [];
 const sum=Object.values(weights).reduce((n,[a,b])=>n+(a+b)/2,0);
 const rows=Object.entries(weights).map(([subject,range])=>({subject,range,exact:count*((range[0]+range[1])/2)/sum}));
 rows.forEach(row=>row.count=Math.floor(row.exact));
 let remaining=count-rows.reduce((n,row)=>n+row.count,0);
 [...rows].sort((a,b)=>(b.exact-b.count)-(a.exact-a.count)).forEach(row=>{if(remaining-->0)row.count++;});
 return rows;
}
export function blueprintInventory(lectures=[],objectivesByLecture={}) {
 const counts={};let unclassified=0;
 for(const l of lectures)for(const o of objectivesByLecture[l.lectureId]||[]) {
  if(!bpmObjective(o))continue;
  const subject=objectiveSubject(o);if(subject)counts[subject]=(counts[subject]||0)+1;else unclassified++;
 }
 return {counts,unclassified};
}
export function allocateBlueprint({exam,requestedCount,eligibleLectures=[],objectivesByLecture={},...args}) {
 const allocation={},missing=[];
 for(const row of subjectTargets(exam,requestedCount)) {
  const candidates=eligibleLectures.map(l=>({...l,objectiveCount:(objectivesByLecture[l.lectureId]||[]).filter(o=>bpmObjective(o)&&objectiveSubject(o)===row.subject).length})).filter(l=>l.objectiveCount);
  if(row.count&&!candidates.length)missing.push(`${SUBJECT_LABELS[row.subject]} (${row.count} questions)`);
  for(const [id,count] of Object.entries(allocateQuestions({...args,eligibleLectures:candidates,requestedCount:row.count})))allocation[slotKey(id,row.subject)]=count;
 }
 if(missing.length)throw new Error(`BPM 2 Test ${exam} needs linked objectives for ${missing.join(', ')}. Subject quotas were not reassigned. Import or link those objectives, or use a regular exam.`);
 return allocation;
}
