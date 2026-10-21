import {linkSourceLecture} from '../shell/features/exam/questionBankLinks.js';
import {supplementaryObjective} from '../shell/logic/objectives.js';
/** Lecture attribution does not imply that any particular objective was tested. */
export function mapAnsweredLectureQuestions(sessions=[],lectures=[],blockId) {
 const allowed=lectures.filter(l=>(!l.blockId || l.blockId===blockId) && !supplementaryObjective(l) && !l.mergedInto);
 const changes=[];
 for(const session of sessions){
  if(session.blockId!==blockId)continue;
  const answered=new Set((session.answers || []).filter(a=>a.value!=null).map(a=>a.questionId));
  for(const question of session.questions || []){
   if(!answered.has(question.questionId))continue;
   if(question.lectureId && allowed.some(l=>l.id===question.lectureId))continue;
   const linked=linkSourceLecture({...question, sourceTitle:question.sourceTitle || session.sourceTitle || session.title, weekNumber:question.weekNumber ?? session.weekNumber},allowed,blockId);
   if(!linked.lectureId || !allowed.some(l=>l.id===linked.lectureId))continue;
   changes.push({sessionId:session.sessionId,questionId:question.questionId,lectureId:linked.lectureId,lectureLabel:linked.lectureLabel,...(linked.curriculumMapping?{curriculumMapping:linked.curriculumMapping}:{}),curriculumLinkStatus:linked.curriculumLinkStatus,lectureLinkBasis:linked.lectureLinkBasis,lectureLinkEvidence:linked.lectureLinkEvidence || [linked.sourceLectureClue].filter(Boolean)});
  }
 }
 return changes;
}
export function applyAnsweredLectureMappings(session,changes) {
 const byId=new Map(changes.filter(c=>c.sessionId===session.sessionId).map(c=>[c.questionId,c]));
 if(!byId.size)return session;
 return {...session,questions:(session.questions || []).map(q=>{
  const patch=byId.get(q.questionId);if(!patch || q.curriculumLinkStatus==='user-confirmed')return q;
  const {sessionId,questionId,...metadata}=patch;
  return {...q,...metadata};
 })};
}
