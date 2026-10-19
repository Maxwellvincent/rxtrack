import { selectSchoolQuestions } from '../exam/schoolQuestionSelection.js';
import { areNearDuplicateQuestions } from '../../../engine/questionSimilarity.js';
import { questionIsExcluded } from '../../../engine/questionScoringPolicy.js';

/** Last-slot recovery may reuse authentic, unseen school items; never manufacture a key or advanced audit. */
export function schoolContinuationQuestions({banks={},metadata={},lecture,blockId,missing,difficulty,history=[],ratings={}}) {
 if(!lecture?.id || missing<1 || missing>3 || difficulty!=='medium')return [];
 const entries=Object.values(metadata||{});
 const sources=Object.entries(banks).map(([filename,questions])=>({filename,questions:(questions||[]).filter(q=>q.sourceRepresentation!=="answer-explanation-summary"&&!questionIsExcluded(q,ratings)&&!history.some(old=>areNearDuplicateQuestions(q,old))),
  blockId:entries.find(entry=>entry.filename===filename||entry.aliases?.includes(filename))?.blockId || questions?.find(q=>q.blockId)?.blockId}));
 const result=selectSchoolQuestions({banks:sources,lectures:[lecture],blockId,allocation:{[lecture.id]:missing},history});
 return result.questions.map(q=>{
  const imageUrl=q.sourceImageUrl||q.sourceImageDataUrl||(typeof q.image==='string'?q.image:q.image?.url);
  return {...q,sourceRepresentation:q.sourceRepresentation||'original-school-question',...(imageUrl?{image:{...(typeof q.image==='object'?q.image:{}),url:imageUrl}}:{})};
 });
}
