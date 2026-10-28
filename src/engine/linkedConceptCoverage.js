import {normAtomKey} from './atomNorm.js';
const norm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Exposure is separate from objective mastery. Only answered linked items rotate history. */
export function linkedConceptPlan(atoms=[],objectives=[],evidence={},count=5){
 const ids=new Set(objectives.map(o=>String(o.id||o.code)));
 const unique=new Map();
 for(const atom of atoms){
  const key=normAtomKey(atom.term);
  if(!key||!atom.content||!atom.objectiveIds?.some(id=>ids.has(String(id))))continue;
  if(!unique.has(key))unique.set(key,{...atom,coverageKey:key});
 }
 const exposure={...(evidence.atoms||{})};
 for(const event of evidence.learningJournal||evidence.evidenceJournal||[]){
  for(const key of event.sourceConceptKeys||[]){const old=exposure[key]||{};
   exposure[key]={...old,attempts:Math.max(1,old.attempts||0),lastSeen:Math.max(old.lastSeen||0,event.at||0)};
  }
 }
 const ranked=[...unique.values()].sort((a,b)=>{
  const x=exposure[a.coverageKey]||{},y=exposure[b.coverageKey]||{};
  return Number((x.attempts||0)>0)-Number((y.attempts||0)>0)
   || Number(b.importanceTier==='core')-Number(a.importanceTier==='core')
   || (x.lastSeen||0)-(y.lastSeen||0);
 });
 const chosen=[],used=new Set();
 const quotas=objectives.map(o=>({id:String(o.id||o.code),left:Math.max(1,o._targetQuestionCount||1)}));
 while(chosen.length<count){let added=false;
  for(const q of quotas){if(q.left<=0||chosen.length>=count)continue;
   const atom=ranked.find(a=>!used.has(a.coverageKey)&&a.objectiveIds.some(id=>String(id)===q.id));
   if(!atom){q.left=0;continue;}chosen.push(atom);used.add(atom.coverageKey);q.left--;added=true;
  }if(!added)break;
 }
 return chosen;
}
export function linkedConceptInstruction(targets=[]){
 if(!targets.length)return '';
 return 'LINKED LECTURE CONCEPT COVERAGE: Rotate across the following underexposed concepts, within their allocated objectives. Test a source-supported relationship for each target, not merely a name-drop or a distractor mention. Use the lecture’s precise terminology and distinguishing clinical clues where needed. If the term would reveal the answer, put it in the keyed choice and explanation instead. Never omit a clue required to distinguish the answer. Do not invent clues, add arithmetic as fake reasoning, or use overlapping anatomical synonyms as mutually exclusive distractors. Explain the source terminology and why the closest distractor differs. Report a source shortfall instead of padding.\n'+targets.map(a=>`- ${a.term} [${a.objectiveIds.join(', ')}]: ${a.content}${a.clinicalCues?.length?` | Source clues: ${a.clinicalCues.join('; ')}`:''}`).join('\n');
}
/** Conservative attribution after independent review, never from incidental wrong choices. */
export function attributeLinkedConcept(question,targets=[]){
 const text=' '+norm([question.stem,question.choices?.[question.correct],question.topic].join(' '))+' ';
 const matching=targets.filter(a=>a.objectiveIds.some(id=>question.objectiveIds?.includes(id))&&norm(a.term).length>=4&&text.includes(' '+norm(a.term)+' '));
 if(!matching.length)return question;
 return {...question,atomKey:question.atomKey||matching[0].coverageKey,sourceConceptKeys:matching.map(a=>a.coverageKey)};
}
