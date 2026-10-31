/** Conservative completeness checks for style references, not medical validation. */
export function schoolExemplarIssues(question = {}) {
 const stem=String(question.stem || '').trim();
 const issues=[];
 if(!stem || !question.choices || Object.keys(question.choices).length<2)issues.push('incomplete_item');
 if(question.answerKeyVerified===false || question.sourceKeyReviewStatus==='stem-mismatch')issues.push('unverified_source_key');
 if(question.sourceRepresentation==='answer-explanation-summary')issues.push('abbreviated_original');
 // Demonstrated imported continuation: "that is being ablated, which ...".
 // A short but complete standalone lead-in remains eligible.
 if(/^(?:that|which)\s+(?:is|was|are|were)\s+being\b/i.test(stem))issues.push('stem_continuation');
 if(/\b(?:described|presented|shown|discussed)\s+in\s+(?:question|item|case)\s*#?\s*\d+\b/i.test(stem))issues.push('missing_prior_question_context');
 return issues;
}
export const usableSchoolExemplar = question => schoolExemplarIssues(question).length===0;

/** A text template cannot supply information that exists only in a source visual. */
export function requiresSchoolFigure(question = {}) {
 if (question.hasImage || question.imageQuestion || question.imageDependent) return true;
 const stem = String(question.stem || '');
 return /\b(?:see\s+(?:the\s+)?(?:attached\s+)?(?:figure|image|graph)|(?:shown|illustrated|depicted)\s+(?:below|above|in\s+(?:the\s+)?(?:figure|image|graph))|(?:figure|graph|image|tracing|recording|photomicrograph)\s+(?:shown|below|above)|indicated\s+by\s+(?:the\s+)?(?:letter|arrow|label))\b/i.test(stem);
}
