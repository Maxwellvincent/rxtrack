// Reject an editorial non-explanation; this is not a medical correctness classifier.
const sourceSilence = /(?:lecture|source|excerpt|evidence)\s+(?:(?:does|do)\s+not|doesn't|doesn’t)\s+(?:support|mention|describe|establish)|(?:not|isn't|isn’t)\s+(?:supported|mentioned|described|established)\s+(?:by|in)\s+(?:the\s+)?(?:lecture|source|excerpt)/i;
const norm = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Validate review evidence placement, not medical truth or a keyword-based diagnosis. */
export function verifiedDiscrimination(claim, question = {}) {
 if (!claim || claim.keyUniquelySupported !== true || claim.alternativeAlsoCorrect !== false) return null;
 const choices=question.choices || {};
 const alternative=String(claim.closestAlternative || '').trim();
 if(claim.alternativeText!=null&&norm(claim.alternativeText)!==norm(choices[alternative]))return null;
 const clue=String(claim.stemClue || '').trim();
 const rationale=String(claim.whyAlternativeFails || '').trim();
 if(!choices[alternative] || alternative===question.correct || clue.length<8 || !norm(question.stem).includes(norm(clue)) || rationale.length<12 || sourceSilence.test(rationale)) return null;
 return {closestAlternative:alternative,...(claim.alternativeText!=null?{alternativeText:String(claim.alternativeText)}:{}),stemClue:clue.slice(0,1200),whyAlternativeFails:rationale.slice(0,1200),keyUniquelySupported:true,alternativeAlsoCorrect:false};
}
export function discriminationIssue(review, question, cfg={}) {
 if(review?.discrimination?.alternativeAlsoCorrect===true || review?.discrimination?.keyUniquelySupported===false)return 'ambiguous_choices';
 if((cfg.requireDiscriminationAudit || review?.discrimination) && !verifiedDiscrimination(review?.discrimination,question))return 'unverified_discriminator';
 return null;
}
export const DISCRIMINATION_REVIEW_CONTRACT = `\nCLOSEST-ALTERNATIVE CHECK: Independently identify the strongest competing option with choices visible. Return discrimination: {"closestAlternative":"exact non-key option letter","alternativeText":"exact full text of that option","stemClue":"exact contiguous quote from the FINAL stem","whyAlternativeFails":"lecture-supported reason this clue favors the key over that alternative","keyUniquelySupported":true,"alternativeAlsoCorrect":false}. These are judgments, never defaults. Copy alternativeText exactly; preserve its relations and qualifiers. Never substitute a stronger rival. Reject weak_distractors when the options are absurd, unrelated or at different conceptual levels. Do not quote the explanation or writer plan as if it were a stem clue. Check overlapping terms, synonyms, broader/narrower categories, and two medically true choices. If distinguishing information is absent, reject as insufficient_clues; if both choices fit, reject as ambiguous_choices. MULTI-WAY SETS: when the item lists discriminationSet (3 or more letters), check EVERY non-key member of that set, not only the closest: each needs a supplied stem finding that rules it out; if any member fits the stem as well as the key, set alternativeAlsoCorrect true (ambiguous_choices), and if any member has no ruling-out finding, reject as insufficient_clues. Do not invent an absent normal finding to rescue the key. Use a comparison baseline, timing, laterality, distribution, response or other actual supplied clue where relevant. Never add a redundant giveaway solely to satisfy this field. POSITIVE DISTINCTION: Explain what the alternative predicts and which supplied finding or source-supported relationship contradicts that prediction. Source silence (for example, “the lecture does not support this option”) is not proof that an option is false and is not an acceptable whyAlternativeFails rationale. If evidence cannot distinguish it, reject rather than inventing a distinction. For spatial alternatives, compare actual relationships; different axes can both be true. A valid clause and plausible rationale establish review traceability, not automatic medical certification.\n`;

/**
 * A multi-way discrimination item names its contrasted letters (key included).
 * Kept only when it is 3 or more distinct letters that exist in the choices and
 * include the key; anything else is dropped rather than trusted.
 */
export function discriminationSetField(question = {}) {
  const choices = question.choices || {};
  const set = [...new Set((Array.isArray(question.discriminationSet) ? question.discriminationSet : []).map(letter => String(letter).trim().toUpperCase()))];
  return set.length >= 3 && set.every(letter => Object.hasOwn(choices, letter)) && set.includes(question.correct) ? { discriminationSet: set } : {};
}
