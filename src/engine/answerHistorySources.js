import {canonicalObjectiveIds} from './objectiveLinks.js';
const normalize=value=>String(value || '').toLowerCase().replace(/\s+/g,' ').trim();
const textOf=o=>normalize(o.objective || o.text || o.content);

/** Restore references only from an exact saved item or an unambiguous legacy stem prefix. */
export function recoverAnswerSource(record, sourceQuestions=[], objectives=[]) {
 const stem=normalize(record.stem);
 const refs=[record.questionKey,record.poolId,record.questionId,record.id].filter(Boolean).map(String);
 const byStem=stem.length>=80?sourceQuestions.filter(q=>normalize(q.stem).startsWith(stem)):[];
 const matches=byStem.length?byStem:sourceQuestions.filter(q=>(!record.sourceFile || !q.sourceFile || normalize(record.sourceFile)===normalize(q.sourceFile)) && refs.some(ref=>[q.questionKey,q.poolId,q.questionId,q.id].filter(Boolean).map(String).includes(ref)));
 if(!matches.length)return {record,basis:null};
 const targets=q=>{
  const explicit=canonicalObjectiveIds([...(q.objectiveIds || []),q.schoolObjectiveCode,...(q.schoolObjectiveCodes || [])].filter(Boolean),objectives);
  if(explicit.length)return explicit;
  return objectives.filter(o=>(!q.lectureId || o.linkedLecId===q.lectureId) && (q.objectiveTexts || []).some(text=>normalize(text)===textOf(o))).map(o=>o.id);
 };
 const signatures=new Set(matches.map(q=>JSON.stringify([q.lectureId || '',targets(q).sort()])));
 if(signatures.size!==1)return {record,basis:'ambiguous-saved-item'};
 const question=matches[0];
 return {record:{...question,...record,lectureId:record.lectureId || question.lectureId,objectiveIds:[...new Set([...(record.objectiveIds || []),...targets(question)])],questionKey:record.questionKey || question.questionKey || question.poolId || question.id || question.questionId || `stem:${question.stem}`,stem:question.stem,sourceFile:record.sourceFile || question.sourceFile},basis:'exact-saved-question',question};
}

export function historySourceQuestions({generated={},banks={},lectures=[],blockId}) {
 const allowed=new Set(lectures.filter(l=>(!l.blockId || l.blockId===blockId)).map(l=>l.id));
 const questions=Object.entries(generated).flatMap(([lectureId,value])=>allowed.has(lectureId)?(value.questions || []).map(q=>({...q,lectureId,sourceFile:q.sourceFile || 'Generated lecture quiz'})):[]);
 for(const [filename,list] of Object.entries(banks)) for(const q of (Array.isArray(list)?list:[]).filter(q=>!q.blockId || q.blockId===blockId))questions.push({...q,sourceFile:filename,objectiveIds:['user-confirmed','evidence-verified'].includes(q.curriculumLinkStatus)?q.objectiveIds:[],objectiveTexts:['user-confirmed','evidence-verified'].includes(q.curriculumLinkStatus)?q.objectiveTexts:[]});
 return questions;
}
