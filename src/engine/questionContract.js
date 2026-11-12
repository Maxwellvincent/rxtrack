import {ANSWER_ROUTE_CONTRACT} from './questionAnswerRoute.js';
/** Shared generated-question contract; source originals retain their own keys/layout. */
export const QUESTION_CONTRACT_VERSION='2026-11-08-necessary-observation';
export const QUESTION_REVIEW_POLICY='2026-11-08-independent-case-necessity';
export const QUESTION_CHOICE_CONTRACT='ANSWER CHOICES: Follow the assigned school example’s complete option count and table layout when supported by plausible, distinct same-category alternatives. Use consecutive option letters from A, including F and beyond when needed. Without an assigned example, prefer five choices. Never invent weak distractors, truncate a valid source pattern, or reject an otherwise sound question solely to meet an aggregate option-count quota. During repair preserve the original complete choice count and layout unless the reported defect requires changing them; independently review every changed question.';
export const GENERATED_QUESTION_CONTRACT=`GENERATED QUESTION CONTRACT ${QUESTION_CONTRACT_VERSION}: Lecture evidence establishes facts; one assigned primary objective establishes scope. Test the actual shortest supported reasoning route. Second-order requires interpreting clues and applying one relationship; third-order requires two connected relationships after clue interpretation. Preserve useful school task structure without decorative patient stories or unsupported complexity. Every admitted advanced question needs current source, objective, discriminator and key-hidden solve checks. Repaired questions receive the same checks; never silently rekey or downgrade a shortfall. ${QUESTION_CHOICE_CONTRACT} ${ANSWER_ROUTE_CONTRACT}`;

/** Same basic admission screen for reviewed drafts, repairs and saved reserves. No cosmetic option ceiling. */
export function questionAdmissionIssues(question={}) {
 const choices=question.choices || {},entries=Object.entries(choices),issues=[];
 if(!String(question.stem || '').trim())issues.push('missing_stem');
 if(entries.length<2 || !Object.hasOwn(choices,question.correct))issues.push('invalid_key_or_choices');
 if(entries.some(([letter,value],index)=>letter!==String.fromCharCode(65+index) || value==null || (typeof value==='string' && !value.trim())))issues.push('incomplete_choices');
 const values=entries.map(([,value])=>JSON.stringify(value).toLowerCase().replace(/\s+/g,' ').trim());
 if(new Set(values).size!==values.length)issues.push('duplicate_choices');
 if((question.objectiveIds || []).length>1)issues.push('multiple_primary_objectives');
 return issues;
}
