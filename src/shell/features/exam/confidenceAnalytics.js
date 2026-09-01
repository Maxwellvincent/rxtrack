const LABELS=['Guess','Unsure','Leaning','Confident','Certain'];
const EXPECTED=[0.2,0.4,0.6,0.8,0.95];
export function confidenceAnalytics(records=[]) {
 const valid=records.filter(r=>Number.isInteger(r.confidence)&&r.confidence>=1&&r.confidence<=5&&typeof r.correct==='boolean');
 const curve=LABELS.map((label,index)=>{const level=index+1,rows=valid.filter(r=>r.confidence===level),correct=rows.filter(r=>r.correct).length;return {level,label,count:rows.length,accuracy:rows.length?correct/rows.length:null,expected:EXPECTED[index]};});
 const high=valid.filter(r=>r.confidence>=4),highCorrect=high.filter(r=>r.correct).length;
 const landmines=high.length-highCorrect;
 const meanGap=valid.length?curve.reduce((sum,row)=>sum+(row.count?Math.abs(row.accuracy-row.expected)*row.count:0),0)/valid.length:null;
 const recent=valid.slice(-50),prior=valid.slice(-100,-50);
 const highAccuracy=list=>{const rows=list.filter(r=>r.confidence>=4);return rows.length?rows.filter(r=>r.correct).length/rows.length:null;};
 return {curve,total:valid.length,highCount:high.length,highAccuracy:high.length?highCorrect/high.length:null,landmines,meanGap,recentHighAccuracy:highAccuracy(recent),priorHighAccuracy:highAccuracy(prior)};
}
export function confidenceTrustMessage(stats){if(stats.highCount<10)return `Keep rating: only ${stats.highCount} high-confidence answers recorded; 10+ gives a more useful signal.`;if(stats.highAccuracy>=0.85)return `Your high confidence has been reliable (${Math.round(stats.highAccuracy*100)}%). Trust it unless the stem contains a qualifier you have not accounted for.`;if(stats.highAccuracy>=0.7)return `Your confidence is directionally useful (${Math.round(stats.highAccuracy*100)}%), but confident misses still deserve a quick qualifier check.`;return `High confidence is not reliable yet (${Math.round(stats.highAccuracy*100)}%). Pause for the lead-in and one disconfirming clue before committing.`;}
