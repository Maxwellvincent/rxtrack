import {compactCoachState} from '../../../engine/practiceAssistance.js';
import {updateExamSessionTransaction} from '../../../supabase.js';
function practiceQuestion(session,id){
 if(session?.status!=='in_progress'||session.format!=='practice'||session.purpose==='reserved-assessment')throw Error('Coaching is available only in untimed practice.');
 const q=session.questions?.find(q=>q.questionId===id);if(!q)throw Error('This practice question is no longer available.');
 if(session.answers?.some(a=>a.questionId===id&&a.value!=null&&a.revealed!==false))throw Error('This answer has already been revealed.');
 return q;
}
export async function markReasoningAssistance(userId,sessionId,questionId,deps={}){
 const result=await (deps.updateSession||updateExamSessionTransaction)(userId,sessionId,current=>{
  const q=practiceQuestion(current,questionId);
  return {...current,questions:current.questions.map(item=>item.questionId===questionId?{...item,assistance:{...q.assistance,used:true,kind:'help-me-reason',turns:(q.assistance?.turns||0)+1}}:item)};
 });
 if(!result)throw Error('Could not save assisted-practice status.');return result;
}
export async function saveReasoningCoach(userId,sessionId,questionId,coach,deps={}){
 const result=await (deps.updateSession||updateExamSessionTransaction)(userId,sessionId,current=>{
  const q=practiceQuestion(current,questionId);if(!q.assistance?.used)throw Error('Save assisted-practice status before coaching.');
  let questions=current.questions.map(item=>item.questionId===questionId?{...item,reasoningCoach:{...compactCoachState(coach),at:Date.now()}}:item);
  let budget=36000;const keep=new Set();
  for(const item of [...questions].filter(q=>q.reasoningCoach).sort((a,b)=>Number(b.questionId===questionId)-Number(a.questionId===questionId)||(b.reasoningCoach.at||0)-(a.reasoningCoach.at||0))){
    const size=JSON.stringify(item.reasoningCoach).length;if(size<=budget){budget-=size;keep.add(item.questionId);}
  }
  questions=questions.map(item=>{if(!item.reasoningCoach||keep.has(item.questionId))return item;const {reasoningCoach:_oldConversation,...rest}=item;return rest;});
  return {...current,questions};
 });
 if(!result)throw Error('Could not save the reasoning conversation.');return result;
}
/** Merge only acknowledged coaching metadata, never replace local answer autosaves. */
export function mergeCoachingSnapshot(session,savedQuestion){
 if(session?.format!=='practice'||session.status!=='in_progress'||session.purpose==='reserved-assessment'||!savedQuestion?.assistance?.used)return session;
 return {...session,questions:(session.questions||[]).map(q=>q.questionId===savedQuestion.questionId?{...q,assistance:savedQuestion.assistance,...(savedQuestion.reasoningCoach?{reasoningCoach:savedQuestion.reasoningCoach}:{})}:q)};
}
