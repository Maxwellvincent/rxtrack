import {protectSessionScoring} from '../../../engine/questionScoringPolicy.js';
import {reservedAssessmentResults} from '../../../engine/reservedAssessment.js';
export function lectureCheckpointResults(session,ratings={}){
 session=protectSessionScoring(session,ratings);
 const result=reservedAssessmentResults(session),excluded=new Set(session.scoringExcludedQuestionIds||[]),answers=new Map((session.answers||[]).map(a=>[a.questionId,a.value])),connections=new Map();
 for(const q of session.questions||[]){if(excluded.has(q.questionId))continue;for(const id of q.sourceRelationshipIds||[]){const row=connections.get(id)||{id,total:0,correct:0};row.total++;if(answers.get(q.questionId)!=null&&answers.get(q.questionId)===q.correct)row.correct++;connections.set(id,row);}}
 return {...result,connections:[...connections.values()].map(row=>({...row,percent:Math.round(100*row.correct/row.total)}))};
}
