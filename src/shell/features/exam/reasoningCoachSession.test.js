import {it,expect,vi} from 'vitest';import {markReasoningAssistance,saveReasoningCoach} from './reasoningCoachSession.js';
const session=()=>({format:'practice',status:'in_progress',questions:[{questionId:'q',choices:{A:'One',B:'Two'},correct:'A'}],answers:[{questionId:'q',value:'B',revealed:false}]});
it('waits for the saved marker and preserves choices, key and saved answer',async()=>{
 let state=session(),finish;const updateSession=vi.fn(async(_u,_s,update)=>{state=update(state);await new Promise(r=>{finish=r;});return state;});
 let completed=false;const job=markReasoningAssistance('u','s','q',{updateSession}).then(()=>{completed=true;});await Promise.resolve();expect(completed).toBe(false);finish();await job;
 expect(state.questions[0]).toMatchObject({correct:'A',choices:{A:'One',B:'Two'},assistance:{used:true,turns:1}});expect(state.answers[0].value).toBe('B');
});
it('rejects strict exams, reserved assessments, stale questions and revealed answers',async()=>{
 for(const state of [{...session(),format:'exam'},{...session(),purpose:'reserved-assessment'},{...session(),status:'submitted'},{...session(),questions:[]},{...session(),answers:[{questionId:'q',value:'A'}]}]){
  await expect(markReasoningAssistance('u','s','q',{updateSession:async(_u,_s,f)=>f(state)})).rejects.toThrow();
 }
});
it('does not save hint history without assistance and retains it across later marker updates',async()=>{
 let state=session();const updateSession=async(_u,_s,f)=>(state=f(state));
 await expect(saveReasoningCoach('u','s','q',{turns:[]},{updateSession})).rejects.toThrow('before coaching');
 await markReasoningAssistance('u','s','q',{updateSession});await saveReasoningCoach('u','s','q',{turns:[{role:'learner',text:'I know the crossing.'}]},{updateSession});await markReasoningAssistance('u','s','q',{updateSession});
 expect(state.questions[0].reasoningCoach.turns[0].text).toBe('I know the crossing.');expect(state.questions[0].assistance.turns).toBe(2);
});
it('bounds conversation storage without dropping raw answers or assistance markers',async()=>{
 let state=session();state.questions=Array.from({length:20},(_,i)=>({questionId:i===0?'q':`q${i}`,correct:'A',assistance:{used:true},reasoningCoach:{at:i,turns:Array.from({length:6},()=>({role:'coach',text:'x'.repeat(700)}))}}));
 const updateSession=async(_u,_s,f)=>(state=f(state));
 await saveReasoningCoach('u','s','q',{turns:Array.from({length:24},()=>({role:'learner',text:'y'.repeat(2000)}))},{updateSession});
 expect(state.questions[0].reasoningCoach.turns).toHaveLength(6);expect(state.questions.every(q=>q.assistance.used&&q.correct==='A')).toBe(true);expect(state.answers[0].value).toBe('B');
 expect(state.questions.reduce((n,q)=>n+(q.reasoningCoach?JSON.stringify(q.reasoningCoach).length:0),0)).toBeLessThanOrEqual(36000);
});
