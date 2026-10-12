// Source keys only. Preserve sparse numbering and match repeated numbers by section/stem.
export function markBoldChoiceItems(items, fontNameFor) {
  return items.map(item => ({ ...item, str: /bold/i.test(fontNameFor(item.fontName) || '') && /^\s*(?:\([A-H]\)|[A-H][.)])(?:\s|$)/.test(item.str || '') ? `✓ ${item.str}` : item.str }));
}
function blocks(text) {
  const source=String(text||'').replace(/\r/g,'').replace(/\f/g,'\n');
  const headings=[...source.matchAll(/(?:^|\n)[ \t]*(\d{1,3})[.)][ \t]+(?=\S)(?!\d+°)/g)];
  return headings.map((h,i)=>{
    const prefix=source.slice(0,h.index);
    const section=[...prefix.matchAll(/(?:^|\n)[ \t]*(NB[ \t]+\d+(?:[ \t]+and[ \t]+\d+)?)[ \t]+([^\n]+)/gi)].at(-1);
    const page=[...prefix.matchAll(/\[PAGE_BREAK:(\d+)\]/g)].at(-1);
    const body=source.slice(h.index+h[0].length,headings[i+1]?.index??source.length).split(/(?:^|\n)\s*NB\s+\d+/i)[0].replace(/(?:\s*\[PAGE_BREAK:\d+\])+\s*$/, '').trim();
    const endPage=[...body.matchAll(/\[PAGE_BREAK:(\d+)\]/g)].at(-1);
    return {num:Number(h[1]),section:section?.[1]?.replace(/\s+/g,' ')||'',title:section?.[2]||'',page:Number(page?.[1]||1),endPage:Number(endPage?.[1]||page?.[1]||1),body:body.replace(/\[PAGE_BREAK:\d+\]/g,'').trim()};
  });
}
const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'');
export function parsePairedSourceDocuments(questionText, answerText) {
  const originals=blocks(questionText); const answers=blocks(answerText); const output=[]; output.sourceIssues=[];
  for(const source of originals) {
    let marks=[...source.body.matchAll(/(?:^|\n)[ \t]*(?:\(([A-H])\)|([A-H])[.)])[ \t]*/g)];
    const firstA=marks.findIndex(m=>(m[1]||m[2])==='A');
    marks=firstA<0?[]:marks.slice(firstA);
    if(marks.length<2) { output.sourceIssues.push(`${source.section || 'bank'} Q${source.num}: incomplete source stem or choices`); continue; }
    const stem=source.body.slice(0,marks[0].index).replace(/\s+/g,' ').trim();
    const choices=Object.fromEntries(marks.map((m,i)=>[m[1]||m[2],source.body.slice(m.index+m[0].length,marks[i+1]?.index??source.body.length).trim()]));
    const candidates=answers.filter(a=>a.num===source.num && a.section===source.section);
    const matched=candidates.filter(a=>/^[A-H][.)]\s/.test(a.body) || normalize(a.body.split(/(?:^|\n)\s*(?:✓\s*)?(?:\(A\)|A[.)])/)[0])===normalize(stem));
    if(matched.length!==1) throw new Error(`Ambiguous or missing source answer: ${source.section || 'bank'} question ${source.num}.`);
    const answer=matched[0];
    const direct=answer.body.match(/^([A-H])[.)]\s*/);
    const highlighted=[...answer.body.matchAll(/(?:^|\n)\s*✓\s*(?:\(([A-H])\)|([A-H])[.)])/g)];
    const correct=direct?.[1] || (highlighted.length===1 ? highlighted[0][1]||highlighted[0][2] : null);
    if(!correct||!choices[correct]) throw new Error(`No unique source-marked answer: ${source.section || 'bank'} question ${source.num}.`);
    output.push({id:`paired-q${output.length+1}`,num:output.length+1,sourceQuestionNumber:source.num,sourceSection:source.section||null,sourceSectionTitle:source.title||null,sourcePage:source.page,sourceEndPage:source.endPage,stem,choices,correct,explanation:direct?answer.body.slice(direct[0].length).trim():answer.body.split(/Explanation:\s*/i)[1]?.trim()||null,hasImage:/\b(?:images?|figures?|photomicrographs?|photographs?|diagrams?|graphs?|charts?|tables?)\b|\b(?:shown below|shown above|lab results are revealed|radiographic examinations[^?]{0,80}shown)\b/i.test(stem),sourceKeyStatus:'present'});
  }
  if(!output.length) throw new Error('No complete paired source questions found.');
  return output;
}
