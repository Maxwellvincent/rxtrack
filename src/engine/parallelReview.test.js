import {it,expect,vi} from 'vitest';
import {auditGeneratedQuestions} from './mcq.js';
it('removes the sequential review wait while preserving both independent verdicts',async()=>{
 vi.useFakeTimers();
 try {
  const quote='Local responses persist after the upstream input is blocked.';
  const question={stem:'A patient has weakness after upstream input is blocked. A local response persists despite this interruption. Which mechanism explains the preserved response?',choices:{A:'Local response mechanism',B:'Upstream input mechanism',C:'Absent response',D:'Unrelated response'},correct:'A',explanation:'The preserved local response is independent of the interrupted upstream input.'};
  const timings=[];
  for(const parallelIndependentReview of [false,true]){
   const start=Date.now();let elapsed;
   const reviewer=async(_system,prompt)=>{
    const blind=prompt.startsWith('Independently solve');
    await new Promise(resolve=>setTimeout(resolve,blind?30:50));
    return {reviews:[blind?{index:0,answer:'A',unique:true,reasoning:{sourceQuotes:[quote]}}:{index:0,approved:true,issues:[]}]};
   };
   const work=auditGeneratedQuestions([question],{requireBlindKeyCheck:true,lectureText:quote.repeat(4)},
    {parallelIndependentReview,skipRepair:true,reviewAIJSON:reviewer}).then(result=>{elapsed=Date.now()-start;return result;});
   await vi.advanceTimersByTimeAsync(100);
   const result=await work;expect(result.questions).toHaveLength(1);expect(result.questions[0].qualityAudit.blindSolve.status).toBe('matched');timings.push(elapsed);
  }
  expect(timings).toEqual([80,50]);
 }finally{vi.useRealTimers();}
});
