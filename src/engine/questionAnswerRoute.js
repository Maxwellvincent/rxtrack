const norm=value=>String(value || '').toLowerCase().replace(/\s+/g,' ').trim();
export const ANSWER_ROUTE_POLICY='2026-11-08-necessary-observation';
export const ANSWER_ROUTE_CONTRACT=`SHORTEST ANSWER ROUTE: Solve with choices visible and name the taught relationship actually required. If the key merely renames a given successful outcome while alternatives describe failure, damage or its opposite, use outcome-restatement: positive-versus-negative wording is not second-order. The same applies to “what would permit recovery?” when only one option describes repair. Changing tense does not fix this shortcut. Repair the discriminator AND plausible competing alternatives using source relationships; report a shortfall if the source cannot support them. Do not count reading a stated finding then choosing its synonym as two inferences. Brief clinical/experimental cases remain valid application when timing, distribution, response or another clue requires a taught relationship to distinguish plausible alternatives. Preserve valid calculations: applying the taught measurement rule to new numbers is not restatement, but one formula alone is not third-order. Hide observations: descriptor-to-property lookup is recall. Paired labels are not third-order without a new dependent prediction. Parallel somatotopy lookups are not a third-order causal chain. Return answerRoute: {"kind":"definition|outcome-restatement|calculation|relationship-application|connected-integration","stemClue":"exact final-stem quote (copy stem words verbatim; join separate verbatim phrases with ...)","requiredRelationship":"necessary taught rule beyond the stated outcome","whyNotRestatement":"actual inference or calculation beyond renaming the finding","outcomeRestatement":false,"choiceShortcut":false}. Use connected-integration when the shortest solution needs two dependent taught relationships joined through an unstated intermediate (A → B → C); two relationships suffice, not three. State both rules and the intermediate in requiredRelationship. Use relationship-application for one necessary rule. Two parallel lookups do not qualify. These are independent judgments, not defaults. Report shortcuts even if the answer is unique and medically correct.`;

export function pairedClassificationOnly(question={}){
 const leadIn=String(question.stem||'').split(/(?<=[.!])\s+/).at(-1)||'';
 return /\bclassif(?:y|ies|ication)\b/i.test(leadIn)&&/\b(?:these|both|two|each)\b/i.test(leadIn)&&Object.values(question.choices||{}).some(value=>typeof value==='string'&&/\bX\b[\s\S]*\bY\b/i.test(value));
}
/** Observed counterexample: parallel coordinates from one somatotopy table are not a causal chain. */
export function parallelSomatotopyOnly(question={}){
 if(!/\b(?:ventral|anterior) horn\b/i.test(question.stem||''))return false;
 const values=Object.values(question.choices||{});
 const axes=[/\b(?:medial|lateral|proximal|distal)\b/i,/\b(?:dorsal|ventral|flexion|extension|flexors?|extensors?)\b/i,/\b(?:rostral|caudal|upper|lower)\b/i];
 return values.length>=3&&values.every(value=>typeof value==='string'&&axes.every(axis=>axis.test(value)));
}
/** A cortical motor lesion's body-side endpoint can bypass the proposed cerebellar route. */
export function corticalBodyLateralityOnly(question={}){
 const stem=String(question.stem||'');
 const leadIn=stem.split(/(?<=[.!])\s+/).at(-1)||'';
 return /\b(?:precentral gyrus|primary motor cortex|cerebral (?:motor cortex|cortex motor areas))\b/i.test(stem)
  && /\b(?:side of the body|body side|body regions?)\b/i.test(leadIn)
  && /\b(?:coordinat|motor|cerebellar)/i.test(leadIn)
  && Object.values(question.choices||{}).some(value=>typeof value==='string'&&/\bleft\b/i.test(value))
  && Object.values(question.choices||{}).some(value=>typeof value==='string'&&/\bright\b/i.test(value));
}
/** A stem clue is verbatim stem text. Solvers often join separate decisive phrases
 * with an ellipsis; accept that only when every fragment (>= 8 chars) is itself
 * verbatim in the stem, so paraphrase still fails. */
export function stemClueInStem(clue,stem){
 const fragments=String(clue||'').split(/\.{3,}|…/).map(norm).filter(Boolean);
 const text=norm(stem);
 return fragments.length>0 && fragments.every(fragment=>fragment.length>=8 && text.includes(fragment));
}
/** Validate the independent claim's traceability; this is not semantic proof. */
export function answerRouteIssue(route,question={},cfg={}){
 const order=question.orderLevel;
 const advanced=(cfg.requireReasoningAudit===true && order!=='first-order') || ['second-order','third-order'].includes(order);
 if(!advanced)return null;
 if(order==='third-order'&&(pairedClassificationOnly(question)||parallelSomatotopyOnly(question)||corticalBodyLateralityOnly(question)))return 'insufficient_reasoning_depth';
 if(route?.outcomeRestatement===true || route?.choiceShortcut===true || ['definition','outcome-restatement'].includes(route?.kind))return 'answer_choice_shortcut';
 if(!route || route.outcomeRestatement!==false || route.choiceShortcut!==false || !['calculation','relationship-application','connected-integration'].includes(route.kind))return 'unverified_answer_route';
 if(order==='third-order' && route.kind!=='connected-integration')return 'insufficient_reasoning_depth';
 if(!stemClueInStem(route.stemClue,question.stem) || norm(route.requiredRelationship).length<16 || norm(route.whyNotRestatement).length<16)return 'unverified_answer_route';
 return null;
}
export function compactAnswerRoute(route){
 return Object.fromEntries(['kind','stemClue','requiredRelationship','whyNotRestatement','outcomeRestatement','choiceShortcut'].map(key=>[key,typeof route[key]==='string'?route[key].slice(0,1000):route[key]]));
}
