const norm = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Validate review evidence placement, not medical truth or a keyword-based diagnosis. */
export function verifiedDiscrimination(claim, question = {}) {
 if (!claim || claim.keyUniquelySupported !== true || claim.alternativeAlsoCorrect !== false) return null;
 const choices=question.choices || {};
 const alternative=String(claim.closestAlternative || '').trim();
 const clue=String(claim.stemClue || '').trim();
 const rationale=String(claim.whyAlternativeFails || '').trim();
 if(!choices[alternative] || alternative===question.correct || clue.length<8 || !norm(question.stem).includes(norm(clue)) || rationale.length<12) return null;
 return {closestAlternative:alternative,stemClue:clue.slice(0,1200),whyAlternativeFails:rationale.slice(0,1200),keyUniquelySupported:true,alternativeAlsoCorrect:false};
}
export function discriminationIssue(review, question, cfg={}) {
 if(review?.discrimination?.alternativeAlsoCorrect===true || review?.discrimination?.keyUniquelySupported===false)return 'ambiguous_choices';
 if((cfg.requireDiscriminationAudit || review?.discrimination) && !verifiedDiscrimination(review?.discrimination,question))return 'unverified_discriminator';
 return null;
}
export const DISCRIMINATION_REVIEW_CONTRACT = `\nCLOSEST-ALTERNATIVE CHECK: Independently identify the strongest competing option with choices visible. Return discrimination: {"closestAlternative":"exact non-key option letter","stemClue":"exact contiguous quote from the FINAL stem","whyAlternativeFails":"lecture-supported reason this clue favors the key over that alternative","keyUniquelySupported":true,"alternativeAlsoCorrect":false}. These are judgments, never defaults. Do not quote the explanation or writer plan as if it were a stem clue. Check overlapping terms, synonyms, broader/narrower categories, and two medically true choices. If distinguishing information is absent, reject as insufficient_clues; if both choices fit, reject as ambiguous_choices. Do not invent an absent normal finding to rescue the key. Use a comparison baseline, timing, laterality, distribution, response or other actual supplied clue where relevant. Never add a redundant giveaway solely to satisfy this field. A valid clause and plausible rationale establish review traceability, not automatic medical certification.\n`;
