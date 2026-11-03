import {it,expect} from 'vitest';
import {beginReservedAssessment,reservedAssessmentResults} from './reservedAssessment.js';
import {reserveSource,recordSourceContext,sourceItemId} from './sourceUse.js';
const q={stem:'Which pathway?',choices:{A:'One',B:'Two'},correct:'A',sourceFile:'School.pdf',questionId:'q',lectureId:'l',objectiveIds:['o']};
it('requires actual reservations and retains unknown historical exposure',()=>{
 expect(()=>beginReservedAssessment({},[q],[],'s',1)).toThrow('Reserve');
 const {registry,snapshot}=beginReservedAssessment(reserveSource({},q.sourceFile,[q]),[q],[],'s',1);
 expect(snapshot).toMatchObject({unknownPriorExposure:1,knownPriorExposure:0,interpretation:'descriptive-only'});
 expect(beginReservedAssessment(registry,[q],[],'s',2)).toEqual({registry,snapshot});
 expect(beginReservedAssessment(registry,[q],[],'next',3).snapshot.knownPriorExposure).toBe(1);
});
it('detects renamed/relettered prior practice and preserves preparation exposure',()=>{
 const reserved=reserveSource({},q.sourceFile,[q]);
 expect(beginReservedAssessment(reserved,[q],[{questions:[{...q,sourceFile:'Alias',choices:{B:'One',A:'Two'}}]}],'s',1).snapshot.knownPriorExposure).toBe(1);
 const exposed=recordSourceContext({},[q],1).registry;
 const next=beginReservedAssessment(reserveSource(exposed,q.sourceFile,[q]),[q],[],'s',2);
 expect(next.snapshot.items[0].priorExposure).toBe('preparation-context');
 expect(next.registry.items[sourceItemId(q)].firstContextAt).toBe(1);
});
it('includes unanswered items and separates missing links and exclusions',()=>{
 const result=reservedAssessmentResults({questions:[q,{...q,questionId:'q2',lectureId:null,objectiveIds:[]},{...q,questionId:'bad'}],answers:[{questionId:'q',value:'A'}]},['bad']);
 expect(result).toMatchObject({percent:50,total:2,correct:1,unanswered:1,excluded:1});
 expect(result.lectures).toEqual([expect.objectContaining({id:'unlinked',percent:0}),expect.objectContaining({id:'l',percent:100})]);
 expect(reservedAssessmentResults({questions:[],answers:[]}).percent).toBeNull();
});

import {compareReservedAssessments} from './reservedAssessment.js';
it('pairs only submitted prior reserved assessments, excludes exam-day and modified content, and invents no score range',()=>{
 const at=Date.parse('2026-11-14T12:00:00');
 const snapshot=beginReservedAssessment(reserveSource({},q.sourceFile,[q]),[q],[],'s',at).snapshot;
 const session={sessionId:'s',blockId:'b',purpose:'reserved-assessment',format:'exam',status:'submitted',submittedAt:at,questions:[q],answers:[],assessment:snapshot};
 const report={id:'r',name:'NB2',blockId:'b',date:'2026-11-16',kind:'exam',percent:80};
 const [pair]=compareReservedAssessments('b',[session,session,{...session,sessionId:'examday',submittedAt:Date.parse('2026-11-16T01:00:00')},{...session,sessionId:'edited',questions:[{...q,correct:'B'}]}],[report]);
 expect(pair).toMatchObject({assessmentCount:1,questionCount:1,assessmentPercent:0,unknownPriorExposure:1,schoolPercent:80,interpretation:'descriptive-only'});
 expect(pair.predictedScore).toBeUndefined();
});

it('stops when exposure metadata exceeds its safe storage bound and honors scoring exclusions',()=>{
 const reserved=reserveSource({},q.sourceFile,[q]);
 expect(()=>beginReservedAssessment({...reserved,note:'x'.repeat(860000)},[q],[],'s',1)).toThrow('history is full');
 const result=reservedAssessmentResults({questions:[q],answers:[{questionId:'q',value:'A'}],scoringExcludedQuestionIds:['q']});
 expect(result).toMatchObject({total:0,excluded:1,percent:null});
});

it('keeps known-exposed retakes out of school-result comparisons',()=>{
 const at=Date.parse('2026-11-14T12:00:00');
 const first=beginReservedAssessment(reserveSource({},q.sourceFile,[q]),[q],[],'s',at);
 const second=beginReservedAssessment(first.registry,[q],[],'retake',at+1000);
 const base={blockId:'b',purpose:'reserved-assessment',format:'exam',status:'submitted',submittedAt:at+2000,questions:[q],answers:[]};
 const [pair]=compareReservedAssessments('b',[{...base,sessionId:'s',assessment:first.snapshot},{...base,sessionId:'retake',assessment:second.snapshot}],[{id:'r',blockId:'b',date:'2026-11-16',percent:80}]);
 expect(pair).toMatchObject({assessmentCount:1,exposedSittingsExcluded:1,questionCount:1,unknownPriorExposure:1});
});
