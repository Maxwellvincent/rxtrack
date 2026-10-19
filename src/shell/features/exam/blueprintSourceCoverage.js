import { objectiveSubject, bpmObjective, subjectTargets, SUBJECT_LABELS } from './bpmBlueprint.js';
import { linkSourceLecture } from './questionBankLinks.js';
import { schoolQuestionIdentity } from './schoolSourceIdentity.js';
import { validBankQuestion } from './launchQuestionBank.js';
import { missingRequiredVisual } from '../../../engine/questionVisual.js';
import { questionIsExcluded } from '../../../engine/questionScoringPolicy.js';

export const SOURCE_GROUPS = {homework:'Homework',examsoft:'ExamSoft / ESoft',imcq:'IMCQs',other:'Other school sources'};
export function blueprintSourceGroup(bank={}) {
 const kind=String(bank.sourceKind||'').toLowerCase().replace(/[\s_-]+/g,'');
 const name=`${bank.filename||''} ${bank.displayName||''}`;
 if(kind==='imcq'||/\bimcqs?\b|integrated\s+mcq/i.test(name))return 'imcq';
 if(/examsoft|esoft/.test(kind)||/exam\s*soft|e[ _-]?soft/i.test(name))return 'examsoft';
 if(['homework','supplemental'].includes(kind)||/homework|worksheet|practice\s+ques\w*ions?/i.test(name))return 'homework';
 return 'other';
}

/** Subject attribution is separate from objective/mastery credit. Never use word-overlap hints. */
export function mapSourceQuestion(question={}, {objectivesByLecture={},lectures=[],blockId,objectiveCatalog=null}={}) {
 const catalog=objectiveCatalog || Object.values(objectivesByLecture).flat();
 const sourceCodes=[question.schoolObjectiveCode,question.sourceObjectiveCode,...(Array.isArray(question.schoolObjectiveCodes)?question.schoolObjectiveCodes:[])].filter(Boolean).map(String);
 const trustedIds=question.curriculumLinkStatus==='user-confirmed' && Array.isArray(question.objectiveIds) ? question.objectiveIds : [];
 const refs=[...new Set([...sourceCodes,...trustedIds].map(String))];
 const linked=refs.length ? catalog.filter(o=>refs.includes(String(o.id))||refs.includes(String(o.code))) : [];
 const coded=sourceCodes.filter(code=>!linked.some(o=>String(o.id)===code||String(o.code)===code)).map(code=>({code}));
 const candidates=[...linked,...coded];
 if(candidates.length) {
  const inScope=candidates.filter(bpmObjective);
  if(!inScope.length)return {status:'outside-course',subject:null,basis:'objective-code'};
  // A mixed course or discipline reference stays unresolved instead of silently picking one.
  if(inScope.length!==candidates.length)return {status:'mixed',subject:null,basis:'objective-code'};
  if(inScope.some(o=>!objectiveSubject(o)))return {status:'unmapped',subject:null,basis:'objective-code'};
  const subjects=new Set(inScope.map(objectiveSubject).filter(Boolean));
  if(subjects.size===1)return {status:'mapped',subject:[...subjects][0],basis:'objective-code',objectiveIds:linked.filter(bpmObjective).map(o=>o.id||o.code)};
  if(subjects.size>1)return {status:'mixed',subject:null,basis:'objective-code'};
 }
 const explicit=objectiveSubject({subject:question.discipline||question.subject});
 if(explicit)return {status:'mapped',subject:explicit,basis:'source-subject'};
 const linkedQuestion=linkSourceLecture(question,lectures,blockId);
 const lecture=lectures.find(l=>l.id===linkedQuestion.lectureId);
 const accepted=['user-confirmed','source-label-matched','content-matched'].includes(linkedQuestion.curriculumLinkStatus);
 if(lecture&&accepted) {
  const objectives=objectivesByLecture[lecture.id]||[];
  if(objectives.length&&objectives.every(o=>!bpmObjective(o)))return {status:'outside-course',subject:null,basis:'lecture-objectives'};
  const relevant=objectives.filter(bpmObjective), subjects=new Set(relevant.map(objectiveSubject).filter(Boolean));
  if(relevant.length&&relevant.every(o=>objectiveSubject(o))&&subjects.size===1)return {status:'mapped',subject:[...subjects][0],basis:'single-discipline-lecture',lectureId:lecture.id};
  if(subjects.size>1)return {status:'mixed',subject:null,basis:'lecture-objectives'};
 }
 return {status:'unmapped',subject:null,basis:null};
}

function summarize(records,targets) {
 const scoped=records.filter(r=>r.status!=='outside-course');
 const mapped=scoped.filter(r=>r.status==='mapped');
 const rows=targets.map(row=>{
  const questions=mapped.filter(r=>r.subject===row.subject);
  const share=mapped.length?questions.length/mapped.length*100:null;
  return {...row,label:SUBJECT_LABELS[row.subject],questions:questions.length,usable:questions.filter(q=>q.usable).length,
   objectives:new Set(questions.flatMap(q=>q.objectiveIds||[])).size,observedShare:share,
   gap:share==null?'No mapped questions':share<row.range[0]?'Below target mix':share>row.range[1]?'Above target mix':'Within target range'};
 });
 return {total:records.length,inScope:scoped.length,mapped:mapped.length,unmapped:scoped.filter(r=>r.status==='unmapped').length,
  mixed:scoped.filter(r=>r.status==='mixed').length,outsideCourse:records.length-scoped.length,
  missingFigures:scoped.filter(r=>r.missingFigure).length,unusable:scoped.filter(r=>!r.usable).length,
  otherSubjects:mapped.filter(r=>!targets.some(t=>t.subject===r.subject)).length,rows};
}

/** Read-only audit: duplicates count once in the pooled view, once per file in source details. */
export function buildBlueprintSourceCoverage({exam=3,banks=[],objectivesByLecture={},lectures=[],ratings={}}={}) {
 const objectiveCatalog=Object.values(objectivesByLecture).flat();
 const targets=subjectTargets(exam,40), unique=new Map(),files=[],groups=Object.fromEntries(Object.keys(SOURCE_GROUPS).map(k=>[k,new Map()]));
 for(const bank of banks) {
  const records=new Map(),group=blueprintSourceGroup(bank);
  for(const question of bank.questions||[]) {
   if(!question?.stem)continue;
   const identity=schoolQuestionIdentity(question);
   const record={...mapSourceQuestion(question,{objectivesByLecture,lectures,blockId:bank.blockId,objectiveCatalog}),
    usable:validBankQuestion(question)&&!questionIsExcluded(question,ratings),missingFigure:missingRequiredVisual(question)};
   // Conflicting mappings of the same item cannot become authoritative by file order.
   const merge=(map)=>{
    const prior=map.get(identity);
    if(!prior){map.set(identity,record);return;}
    const conflict=prior.status==='mapped'&&record.status==='mapped'&&prior.subject!==record.subject;
    const incompatible=prior.status==='outside-course'&&record.status!=='outside-course'||record.status==='outside-course'&&prior.status!=='outside-course';
    if(conflict||incompatible||prior.status==='mixed'||record.status==='mixed')map.set(identity,{...prior,status:'mixed',subject:null,usable:prior.usable||record.usable,missingFigure:prior.missingFigure&&record.missingFigure});
    else map.set(identity,{...(prior.status==='mapped'||record.status!=='mapped'?prior:record),usable:prior.usable||record.usable,missingFigure:prior.missingFigure&&record.missingFigure,objectiveIds:[...new Set([...(prior.objectiveIds||[]),...(record.objectiveIds||[])])]});
   };
   merge(records);merge(unique);merge(groups[group]);
  }
  files.push({filename:bank.filename,sourceGroup:group,...summarize([...records.values()],targets)});
 }
 return {...summarize([...unique.values()],targets),rawQuestions:banks.reduce((n,b)=>n+(b.questions?.length||0),0),files,
  groups:Object.entries(groups).map(([key,records])=>({key,label:SOURCE_GROUPS[key],...summarize([...records.values()],targets)}))};
}
