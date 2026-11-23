/** Search metadata locates teaching material; only original source text can prove a link. */
const ignored=new Set('the and with from this that which following patient likely lecture lectures describe explain identify disorder disorders week questions question practice homework updated'.split(' '));
export function curriculumTerms(value){
 let text=String(value||'');try{text=decodeURIComponent(text);}catch{/* literal imported label */}
 return [...new Set((text.normalize('NFKC').toLowerCase().replace(/[+_]/g,' ').match(/[a-z]{3,}/g)||[]).map(word=>word.replace(/s$/,'')).filter(word=>!ignored.has(word)))];
}
const sourceOf=l=>{const chunks=(l.chunks||[]).map(c=>c.markdown||c.text||c.content||'').filter(value=>typeof value==='string'&&value.trim()).join('\n\n');return chunks||l.extractedText||l.fullText||l.content||'';};
const cache=new WeakMap();
export function curriculumConceptIndex(lectures=[],objectives=[]){
 return lectures.map(lecture=>{
  const targets=objectives.filter(o=>o.linkedLecId===lecture.id),signature=targets.map(o=>`${o.id}:${o.objective||o.text||''}`).join('|');
  const previous=cache.get(lecture);if(previous?.signature===signature)return previous.entry;
  const source=sourceOf(lecture),title=lecture.lectureTitle||lecture.title||lecture.fileName||lecture.filename||'';
  const concepts=[...targets.map(o=>o.objective||o.text||''),...(lecture.atoms||[]).map(a=>`${a.term||''} ${a.content||''}`),...(lecture.mappingConcepts||[])];
  const entry={lecture,source,title,titleTerms:new Set(curriculumTerms(title)),concepts,conceptTerms:new Set(curriculumTerms(concepts.join(' '))),sourceTerms:new Set(curriculumTerms(source))};
  cache.set(lecture,{signature,entry});return entry;
 });
}
export function sectionLectureCandidates(question,index=[]){
 const query=curriculumTerms([question.sourceSectionTitle,question.sourceSection].filter(Boolean).join(' '));
 if(!query.length)return [];
 return index.map(entry=>({entry,hits:query.filter(t=>entry.titleTerms.has(t))})).filter(row=>row.hits.length>=2||query.length===1&&row.hits.length===1&&query[0].length>=7)
  .sort((a,b)=>b.hits.length-a.hits.length).map(row=>row.entry.lecture);
}
export function rankCurriculumConcepts(question,index=[]){
 const query=curriculumTerms([question.stem,question.topic,question.choices?.[question.correct],question.explanation,question.mappingQuery].filter(Boolean).join(' '));
 const df=t=>index.filter(e=>e.sourceTerms.has(t)||e.conceptTerms.has(t)||e.titleTerms.has(t)).length;
 return index.map(entry=>{const hits=query.filter(t=>entry.sourceTerms.has(t)||entry.conceptTerms.has(t)||entry.titleTerms.has(t));
  const score=hits.reduce((sum,t)=>sum+(1+Math.log((index.length+1)/(1+df(t))))*(entry.titleTerms.has(t)?8:entry.conceptTerms.has(t)?4:1),0);
  return {lecture:entry.lecture,concepts:entry.concepts,matchedTerms:hits,score};
 }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score);
}
