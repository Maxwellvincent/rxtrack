/** Legacy attempts remain independent unless assistance was explicitly recorded. */
export const isIndependentAttempt = value => value?.assisted !== true && value?.assistance?.used !== true;
export function assistanceFields(value={}) {
 const assisted=!isIndependentAttempt(value);
 return assisted?{assisted:true,assistance:{used:true,kind:'help-me-reason',turns:Math.max(0,Number(value.assistance?.turns)||0)}}:{};
}
/** Keep resumable coaching compact; raw questions and assistance markers are untouched. */
export function compactCoachState(coach={}) {
 return {turns:(Array.isArray(coach.turns)?coach.turns:[]).slice(-6).map(turn=>({role:turn.role==='learner'?'learner':'coach',text:String(turn.text||'').slice(0,turn.role==='learner'?700:1200),...(turn.readyToTry===true?{readyToTry:true}:{})}))};
}
