/** Pause routine block queues after the local exam/end date; never alter study history. */
const localDay=value=>{
 if(!value)return null;
 const match=typeof value==='string' && value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 const date=match?new Date(+match[1],+match[2]-1,+match[3]):new Date(value);
 if(!Number.isFinite(date.getTime()))return null;
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};
export function blockReviewPolicy(block={},now=Date.now(),examDate){
 const today=localDay(now),end=localDay(examDate || block.examDate || block.endDate);
 const finished=['complete','completed','archived'].includes(String(block.status || '').toLowerCase());
 const suspended=finished || !!(today && end && today>end);
 return {suspended,reason:finished?'block-complete':suspended?'block-ended':null,endedOn:end};
}
export function contextBlockReviewPolicy(context={}){
 const block=context.blockMeta || (context.terms || []).flatMap(t=>t.blocks || []).find(b=>b.id===context.blockId) || {};
 return blockReviewPolicy(block,context.now ?? Date.now(),context.examDate ?? context.examDates?.[context.blockId]);
}
