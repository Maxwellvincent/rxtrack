/** Short transport references avoid mistyped durable IDs; E-IDs remain factual citations. */
export function connectionReviewPrompt(targets=[]){
 if(!targets.length)return '';
 return '\nCONNECTION OWNERSHIP CATALOG (not answer keys):\n'+JSON.stringify(targets.map((row,index)=>({id:`C${index+1}`,objectiveId:row.objectiveId,clause:row.label,quote:row.quote,page:row.page})))+'\nSeparately identify which of these connections are actually REQUIRED to solve each final item, not incidental words or distractors. Return sourceRelationshipIds:["C1"] (cr:["C1"] for compact local transport). C references are connection identities; E references are source evidence citations and MUST NOT be placed in sourceRelationshipIds/cr. Use [] when none is genuinely tested. This classification does not override any source, objective, key or reasoning check.\n';
}
export function reviewedConnectionIds(ids,targets=[]){
 const aliases=new Map(targets.map((row,index)=>[`C${index+1}`,row.id]));
 const allowed=new Set(targets.map(row=>row.id));
 return [...new Set((Array.isArray(ids)?ids:[]).map(id=>aliases.get(id)||id).filter(id=>allowed.has(id)))];
}
