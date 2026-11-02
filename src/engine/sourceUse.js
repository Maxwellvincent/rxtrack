const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
const canonical = value => value && typeof value === 'object' ? JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,cell])=>[normalize(key),normalize(cell)])) : normalize(value);
export function stableRecordId(value, prefix='r') {
 const text=typeof value==='string'?value:JSON.stringify(value);
 return prefix+'-'+[2166136261,2246822519,3266489917,668265263].map(seed=>{
  let hash=seed;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
  return (hash>>>0).toString(16).padStart(8,'0');
 }).join('');
}
/** Same content across filenames, keys and option lettering remains the same reserve. */
export function sourceItemId(question={}) {
 return stableRecordId(JSON.stringify([normalize(question.stem),Object.values(question.choices || {}).map(canonical).sort()]),'source');
}
export const emptySourceUse = () => ({version:1,items:{},sources:{}});
export function isEvaluationReserved(question={},registry={}) {
 return question.evaluationReserved===true || registry.items?.[sourceItemId(question)]?.reserved===true
  || registry.sources?.[question.sourceFile || question.filename]?.reserved===true;
}
export function allowedGenerationExamples(questions=[],registry={}) {
 return questions.filter(question=>!isEvaluationReserved(question,registry));
}
export function reserveSource(current,filename,questions=[],reserved=true,at=Date.now()) {
 if(!String(filename || '').trim())throw new Error('Choose a source file.');
 const next={...emptySourceUse(),...current,items:{...current?.items},sources:{...current?.sources}};
 next.sources[filename]={...next.sources[filename],reserved,changedAt:at};
 for(const question of questions){const id=sourceItemId(question),previous=next.items[id] || {};
  const sources=new Set(previous.reservedSources || (previous.reserved && previous.sourceFile?[previous.sourceFile]:[]));
  if(reserved)sources.add(filename);else sources.delete(filename);
  next.items[id]={...previous,reserved:sources.size>0,reservedSources:[...sources],sourceFile:filename,reservedAt:reserved?(previous.reservedAt || at):previous.reservedAt || null,
   exposure:previous.exposure || 'unknown'};
 }
 return next;
}
/** Supplied context is recorded conservatively before transmission, not a claim of model use. */
export function recordSourceContext(current,questions=[],at=Date.now()) {
 const allowed=allowedGenerationExamples(questions,current);
 const next={...emptySourceUse(),...current,items:{...current?.items},sources:{...current?.sources}};
 for(const question of allowed){const id=sourceItemId(question),previous=next.items[id] || {};
  next.items[id]={...previous,sourceFile:question.sourceFile || question.filename || null,
   exposure:'preparation-context',firstContextAt:previous.firstContextAt || at,lastContextAt:at};
 }
 // Do not evict reservations or claim completeness when a record would exceed Firestore's limit.
 if(new TextEncoder().encode(JSON.stringify(next)).length>850000)throw new Error('Source exposure registry is full. Preparation stopped before sending examples.');
 return {registry:next,allowed};
}
export function sourceExposure(question,registry={}) {
 return registry.items?.[sourceItemId(question)]?.exposure || 'unknown';
}
