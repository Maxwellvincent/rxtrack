import { cleanSchoolQuestion } from '../../../engine/schoolSourceText.js';
const sourceIdentity = q => q.sourceSection && q.sourceQuestionNumber != null ? `${q.sourceSection.replace(/\s/g,'')}:${q.sourceQuestionNumber}` : null;
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const optionMeaning = value => normalized(value).replace(/^visual option ([a-m])$/, '$1');
/** Reconcile exact source identities only; preserve session IDs and selected option meaning. */
export function repairSessionSource(session, originals) {
  const answers = (session.answers || []).map(a=>({...a}));
  let repaired=0;
  const questions=(session.questions || []).map(q=>{
    const id=sourceIdentity(q);
    const matches=originals.filter(original=>id && sourceIdentity(original)===id);
    if(matches.length!==1 || normalized(matches[0].stem)!==normalized(q.stem))return q;
    const source=cleanSchoolQuestion(matches[0]);
    const answer=answers.find(a=>a.questionId===q.questionId && a.value!=null);
    if(answer){
      const chosen=q.choices?.[answer.value];
      const candidates=Object.entries(source.choices || {}).filter(([,value])=>optionMeaning(value)===optionMeaning(chosen));
      if(candidates.length!==1)return q; // Never reinterpret an ambiguous old pick.
      answer.value=candidates[0][0];
    }
    repaired++;
    return {...q,choices:source.choices,correct:source.correct,sourcePage:source.sourcePage,sourceEndPage:source.sourceEndPage,
      sourceSectionTitle:source.sourceSectionTitle,sourceKeyCandidate:source.sourceKeyCandidate || null,
      sourceKeyReviewStatus:source.sourceKeyReviewStatus || null,sourceKeyCritique:source.sourceKeyCritique || null,
      sourceKeyTextCandidate:source.sourceKeyTextCandidate || null,sourceReportedKeyText:source.sourceReportedKeyText || null,
      sourceOriginalChoices:q.sourceOriginalChoices || q.choices,sourceOriginalKey:q.sourceOriginalKey || q.correct,
      sourceRepairVersion:1,sourceVisualChoicesUnverified:!!source.sourceVisualChoicesUnverified,hasImage:!!(q.hasImage || source.imageQuestion || source.hasImage)};
  });
  return {...session,questions,answers,sourceRepairCount:repaired};
}
