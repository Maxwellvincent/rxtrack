/** Compact model transport only. Missing verdicts remain missing, never approved. */
export function decodeLocalQuestionWire(result) {
  if (!result || typeof result !== 'object') return result;
  const decoded = { ...result };
  if (Array.isArray(result.questions)) decoded.questions = result.questions.map(q => {
    if (!q || q.stem !== undefined || q.s === undefined) return q;
    const p = Array.isArray(q.p) ? q.p : [];
    return { stem:q.s, choices:q.c, correct:q.k, explanation:q.e, whyWrong:{...q.w,...(q.k && q.e ? {[q.k]:q.e} : {})},
      objectiveIds:q.o, topic:q.t, objectiveFacet:q.f, orderLevel:q.l,
      taskType:q.u, reasoningSteps:q.r, difficulty:q.h,
      ...(q.p !== undefined ? {questionPlan:{relationship:p[0],perturbation:p[1],inference:p[2],endpoint:p[3],nearestDistractor:p[4],discriminator:p[5],sourceQuotes:p[6]}} : {}),
    };
  });
  if (Array.isArray(result.reviews)) decoded.reviews = result.reviews.map(v => {
    if (!v || v.index !== undefined || v.i === undefined) return v;
    const route = Array.isArray(v.b) ? v.b : [];
    if (v.b !== undefined) return {index:v.i,answer:v.k,unique:v.a,
      answerRoute:{kind:route[0],stemClue:route[1],requiredRelationship:route[2],whyNotRestatement:route[3],outcomeRestatement:route[4],choiceShortcut:route[5]},reasoning:{evidenceIds:v.z}};
    const own=Array.isArray(v.o)?v.o:[],d=Array.isArray(v.d)?v.d:[],r=Array.isArray(v.r)?v.r:[];
    return {index:v.i,approved:v.a,objectiveAligned:v.al,issues:v.x,rationale:v.n,
      objectiveAlignment:{objectiveId:own[0],objectiveClause:own[1],testedRelationship:own[2],bestSourceObjectiveCode:own[3],whyAssignedOverNeighbor:own[4]},
      discrimination:!Array.isArray(v.d) && v.d && typeof v.d === "object" ? v.d : {closestAlternative:d[0],stemClue:d[1],whyAlternativeFails:d[2],keyUniquelySupported:d[3],alternativeAlsoCorrect:d[4]},
      reasoning:{orderLevel:r[0],steps:r[1],evidenceIds:r[2],allStepsRequired:r[3],connectedChain:r[4],singleEndpoint:r[5],choiceShortcut:r[6]},
    };
  });
  return decoded;
}
export const LOCAL_WRITER_WIRE = `Return only the completed questions, not construction plans or self-review reports. An independent reviewer supplies verified reasoning metadata afterward. Keep every decisive clinical clue. Usually use 1-2 explanation sentences and one short, positive contradiction per wrong choice; do not repeat the case in the explanation. w contains wrong choices only; the correct choice already has e. No construction plan, source quote list, reasoning-step list or optional metadata in the writer response.
Return ONLY JSON: {"questions":[{"s":"complete clinical stem and focused lead-in","c":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"k":"A","e":"explain the clue-to-answer relationship","w":{"B":"specific contradiction","C":"specific contradiction","D":"specific contradiction","E":"specific contradiction"},"o":["assigned objective id"],"t":"concept","l":"second-order","u":"clinical-application","h":"requested difficulty"}]}`;
export const LOCAL_AUDIT_WIRE = `Return compact review transport. i=index; a=approved; al=objectiveAligned; x=issues; n=brief rejection reason (empty if approved). o=objectiveAlignment [objectiveId,objectiveClause,testedRelationship,bestSourceObjectiveCode,whyAssignedOverNeighbor]. d is the named discrimination object below. r=reasoning [orderLevel,steps,evidenceIds,allStepsRequired,connectedChain,singleEndpoint,choiceShortcut]. Every verdict must be explicit. Every reasoning step must name the actual relationship in this item. The d.stemClue MUST be a short exact contiguous substring copied from the FINAL question stem, not a restated case, plan, or explanation. The closestAlternative must be a real NON-KEY letter from this item's displayed choices. Give a real positive comparison: what that alternative predicts and which supplied observation contradicts it. Never copy schema placeholders as findings or rationales. If these checks fail, reject rather than fill a template.
Return ONLY JSON: {"reviews":[{"i":0,"a":true,"al":true,"x":[],"n":"","o":["assigned id","exact assigned clause","actual tested relationship","exact strongest source code","specific ownership distinction"],"d":{"closestAlternative":"non-key letter","alternativeText":"exact full option text","stemClue":"exact short quote copied from final stem","whyAlternativeFails":"specific prediction contradicted by the supplied observation","keyUniquelySupported":true,"alternativeAlsoCorrect":false},"r":["second-order",["specific clue interpretation","specific relationship applied"],["E1"],true,true,true,false]}]}`;
export const LOCAL_BLIND_WIRE = `Return compact blind-solve transport. i=index; k=independently selected answer or null; a=unique. b=answerRoute [kind,stemClue,requiredRelationship,whyNotRestatement,outcomeRestatement,choiceShortcut]; z=reasoning.evidenceIds. Every flag must be explicit. Use concise phrases without repeating the case.
Return ONLY JSON: {"reviews":[{"i":0,"k":"A","a":true,"b":["relationship-application","exact clue","necessary taught rule","necessary inference",false,false],"z":["E1"]}]}`;

export const LOCAL_FAST_WRITER_WIRE = `Output the completed clinical questions and proposed keys only. Silently verify each proposed key against an exact source passage before responding. e is a SHORT EXACT SOURCE QUOTE supporting that key, not the final explanation. An independent key-hidden reviewer writes the final rationales and reasoning metadata. Do not output construction plans, self-review, reasoning reports or wrong-option rationales. Preserve all decisive clues and complete supported choices.
Return ONLY JSON: {"questions":[{"s":"complete clinical question and focused lead-in","c":{"A":"...","B":"...","C":"...","D":"...","E":"..."},"k":"A","e":"short exact supporting source quote","o":["assigned objective id"],"t":"concept","l":"second-order","u":"clinical-application","h":"requested difficulty"}]}`;
