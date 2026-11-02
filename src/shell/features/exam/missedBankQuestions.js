import {protectSessionScoring} from '../../../engine/questionScoringPolicy.js';
import {schoolQuestionIdentity} from './schoolSourceIdentity.js';
/** Derived from saved answers: no second miss list to fall out of sync. */
export function missedBankQuestions({bank,sessions=[],blockId,ratings={}}){
 const files=new Set([bank.filename,...(bank.aliases||[])]),latest=new Map();
 for(const saved of sessions){
  if(saved.blockId!==blockId||!files.has(saved.sourceFile))continue;
  if(!['submitted','in_progress'].includes(saved.status))continue;
  const raw=saved.status==='in_progress'?saved.checkpointAnswers||saved.answers||[]:saved.answers||[];
  const session=protectSessionScoring({...saved,answers:raw},ratings);
  const questions=new Map((session.questions||[]).map(q=>[q.questionId,q]));
  for(const answer of session.answers||[]){
   const q=questions.get(answer.questionId);
   if(!q||!Object.hasOwn(q.choices||{},q.correct)||!Object.hasOwn(q.choices||{},answer.value))continue;
   const key=schoolQuestionIdentity(q);
   const at=Number(answer.answeredAt)||Number(saved.submittedAt)||saved.updatedAt?.toMillis?.()||Number(saved.updatedAt)||Number(saved.startedAt)||0;
   const old=latest.get(key);
   if(!old||at>old.at||(at===old.at&&answer.value===q.correct))latest.set(key,{at,wrong:answer.value!==q.correct});
  }
 }
 return (bank.questions||[]).filter(q=>latest.get(schoolQuestionIdentity(q))?.wrong);
}
