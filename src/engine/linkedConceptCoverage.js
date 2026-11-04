import {normAtomKey} from './atomNorm.js';
const norm=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Source-linked concepts are a bounded inventory, not every possible objective facet. */
export function linkedConceptCoverage(atoms=[],objectives=[],evidence={}) {
 const ids=new Set(objectives.map(o=>String(o.id||o.code)));
 const unique=new Map();
 for(const atom of atoms){
  const key=normAtomKey(atom.term);
  const links=(atom.objectiveIds||[]).map(String).filter(id=>ids.has(id));
  if(!key||!atom.content||!links.length)continue;
  const identity=JSON.stringify([key,[...links].sort()]);
  if(!unique.has(identity))unique.set(identity,{...atom,coverageKey:key,objectiveIds:links,attempts:0,correct:0,lastSeen:0,lastCorrect:null});
 }
 const events=[...(evidence.learningJournal || evidence.evidenceJournal || [])].sort((a,b)=>(a.at||0)-(b.at||0));
 for(const row of unique.values()){
  const seen=new Set();
  for(const event of events){
   if(!event.objectiveIds?.some(id=>row.objectiveIds.includes(String(id))) || typeof event.correct!=='boolean')continue;
   const keys=[...(event.sourceConceptKeys||[]),event.atomKey].filter(Boolean).map(normAtomKey);
   if(!keys.includes(row.coverageKey))continue;
   const identity=event.eventId||JSON.stringify([event.sessionKey,event.questionKey,event.at]);
   if(seen.has(identity))continue;seen.add(identity);
   row.attempts++;row.correct+=event.correct?1:0;row.lastSeen=event.at||0;row.lastCorrect=event.correct;
  }
 }
 return [...unique.values()];
}

export function objectivesWithConceptGaps(objectives=[],atoms=[],evidence={}) {
 const gaps=linkedConceptCoverage(atoms,objectives,evidence).filter(row=>!row.attempts);
 return objectives.map(objective=>({...objective,_conceptCoverageGap:gaps.some(row=>row.objectiveIds.includes(String(objective.id||objective.code)))}));
}

/** Exposure is separate from objective mastery. Only answered linked items rotate history. */
export function linkedConceptPlan(atoms=[],objectives=[],evidence={},count=5){
 const inventory=linkedConceptCoverage(atoms,objectives,evidence);
 const planned=new Set((evidence.plannedConceptEvents || []).flatMap(event=>event.sourceConceptKeys || []));
 const ranked=inventory.map(row=>({...row,planIdentity:JSON.stringify([row.coverageKey,row.objectiveIds]),planned:planned.has(row.coverageKey)})).sort((a,b)=>
  Number(a.attempts>0 || a.planned)-Number(b.attempts>0 || b.planned)
  || Number(b.lastCorrect===false)-Number(a.lastCorrect===false)
  || Number(b.importanceTier==='core')-Number(a.importanceTier==='core')
  || a.lastSeen-b.lastSeen);
 const chosen=[],used=new Set();
 const quotas=objectives.map(o=>({id:String(o.id||o.code),left:Math.max(1,o._targetQuestionCount||1)}));
 while(chosen.length<count){let added=false;
  for(const q of quotas){if(q.left<=0||chosen.length>=count)continue;
   const atom=ranked.find(a=>!used.has(a.planIdentity)&&a.objectiveIds.some(id=>String(id)===q.id));
   if(!atom){q.left=0;continue;}chosen.push(atom);used.add(atom.planIdentity);q.left--;added=true;
  }if(!added)break;
 }
 return chosen;
}
export function linkedConceptInstruction(targets=[]){
 if(!targets.length)return '';
 return 'LINKED LECTURE CONCEPT COVERAGE: Prefer the following underexposed concepts when they fit the allocated objective and requested reasoning. These are coverage suggestions, not mandatory question targets. The objective task takes priority over a tagged term. Choose another supported concept when a suggested term would force recall or a different objective. Test a source-supported relationship for any concept you claim to cover, not merely a name-drop or a distractor mention. Use the lecture’s precise terminology and distinguishing clinical clues where needed. If the term would reveal the answer, put it in the keyed choice and explanation instead. Never omit a clue required to distinguish the answer. Do not invent clues, add arithmetic as fake reasoning, or use overlapping anatomical synonyms as mutually exclusive distractors. Explain the source terminology and why the closest distractor differs. Report a source shortfall instead of padding.\n'+targets.map(a=>`- ${a.term} [${a.objectiveIds.join(', ')}]: ${a.content}${a.clinicalCues?.length?` | Source clues: ${a.clinicalCues.join('; ')}`:''}`).join('\n');
}
/** Conservative attribution after independent review, never from incidental wrong choices. */
export function attributeLinkedConcept(question,targets=[]){
 const text=' '+norm([question.stem,question.choices?.[question.correct],question.topic].join(' '))+' ';
 const matching=targets.filter(a=>a.objectiveIds.some(id=>question.objectiveIds?.includes(id))&&norm(a.term).length>=4&&text.includes(' '+norm(a.term)+' '));
 if(!matching.length)return question;
 return {...question,atomKey:question.atomKey||matching[0].coverageKey,sourceConceptKeys:matching.map(a=>a.coverageKey)};
}
