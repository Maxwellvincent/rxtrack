export function classifyReviewPage(page){
 const text=String(page.text || '').trim();
 const question=/\?|\b(?:which|what|where|who)\b/i.test(text);
 const letters=[...new Set([...text.matchAll(/^\s*[•-]?\s*\(?([A-N])[.)]\s/gm)].map(m=>m[1]))].sort();
 const incomplete=letters.length>=2&&(!question||letters[0]!=='A'||letters.some((v,i)=>v!==String.fromCharCode(65+i)));
 const requiresFigure=(question&&/\b(?:below|shown|pictured|image|diagram|figure|curve|graph|encircled|labeled|labelled|letter|arrow|marked|hatched|impulse [a-h]|patch [a-h])\b/i.test(text)) || /cell membrane potential|time \(msec\)/i.test(text);
 return {requiresFigure,kind:question?'unkeyed-worked-example':'review-teaching',keyStatus:'unverified',held:page.method==='failed'||page.confidence<0.65||text.length<70||incomplete,holdReason:incomplete?'incomplete-question-or-choices':page.method==='failed'?'extraction-failed':page.confidence<0.65?'low-ocr-confidence':text.length<70?'insufficient-text':null};
}
