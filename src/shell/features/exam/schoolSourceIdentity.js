import { cleanSchoolQuestion } from '../../../engine/schoolSourceText.js';
import { questionEvidenceKey } from '../../../stores/learnerEvidence.js';
const normalize=value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
export function schoolQuestionIdentity(question) {
 question=cleanSchoolQuestion(question);
 return questionEvidenceKey(JSON.stringify([normalize(question.stem),Object.values(question.choices||{}).map(normalize).sort(),normalize(question.choices?.[question.correct])]));
}
