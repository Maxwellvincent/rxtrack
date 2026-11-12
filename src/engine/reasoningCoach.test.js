import {it,expect,vi} from 'vitest';
import {coachPrompt,safeCoachTurn,reasoningCoachTurn} from './reasoningCoach.js';
const question={stem:'A patient has crossed face and body sensory findings. Which site explains this?',choices:{A:'Left lateral medulla',B:'Right lateral medulla'},correct:'A',explanation:'SECRET EXPLANATION',questionPlan:{endpoint:'SECRET PLAN'},reasoningAudit:{sourceQuotes:['Body pain fibers cross in the spinal cord.']}};
it('withholds choices, key, explanation and solution plan from the coach writer',()=>{
 const prompt=coachPrompt(question,[{role:'learner',text:'I think the body tract has crossed already.'}]);
 for(const secret of ['Left lateral medulla','Right lateral medulla','SECRET EXPLANATION','SECRET PLAN'])expect(prompt).not.toContain(secret);
 expect(prompt).toContain('I think the body tract has crossed already.');expect(prompt).toContain('Body pain fibers cross in the spinal cord.');
});
it('blocks direct choice disclosure and final-answer confirmation',()=>{
 const valid={feedback:'You separated the facial and body findings.',hint:'Trace each pathway from its entry point.',question:'Where does the body pathway cross?'};
 expect(safeCoachTurn(valid,question)).toEqual({...valid,readyToTry:false});
 for(const feedback of ['The answer is A.','Choose A.','You are correct.','The left lateral medulla explains this.'])expect(safeCoachTurn({...valid,feedback},question)).toBeNull();
 expect(safeCoachTurn({...valid,question:'The lesion is here.'},question)).toBeNull();
});
it('asks one targeted next step and fails closed rather than showing a leaked answer',async()=>{
 const callAIJSON=vi.fn(async()=>({feedback:'You identified that a crossing matters.',hint:'Compare the crossing level with the lesion level.',question:'Has the body pathway crossed before reaching this level?'}));
 const reply=await reasoningCoachTurn({question,turns:[{role:'learner',text:'I am unsure where it crosses.'}],action:'next-step'},{callAIJSON,readLectures:()=>[]});
 expect(reply.question).toContain('crossed');expect(callAIJSON.mock.calls[0][1]).toContain('next-step');
 callAIJSON.mockResolvedValue({feedback:'The answer is A.',question:'Why?',hint:''});
 await expect(reasoningCoachTurn({question},{callAIJSON,readLectures:()=>[]})).rejects.toThrow('withheld');
});
it('allows choosing a clue without mistaking the article a for an answer letter',()=>{
 expect(safeCoachTurn({feedback:'Choose a finding to start with.',hint:'',question:'Which finding helps you localize first?'},question)).not.toBeNull();
});
it('uses the exact lecture and block context rather than a neighboring source',async()=>{
 const callAIJSON=vi.fn(async()=>({feedback:'Focus on the required connection.',hint:'',question:'Which connection must the signal traverse?'}));
 const readLectures=()=>[{id:'l',blockId:'old',chunks:[{text:'WRONG_BLOCK_SECRET'}]},{id:'l',blockId:'NB2',chunks:[{text:'A motor neuron pathway connects an upper neuron to a lower neuron. The lower neuron directly supplies somatic muscle.'}]}];
 await reasoningCoachTurn({question:{...question,lectureId:'l',blockId:'NB2',stem:'Which motor neuron pathway connection is required?'}},{callAIJSON,readLectures});
 const prompt=callAIJSON.mock.calls[0][1];expect(prompt).toContain('directly supplies somatic muscle');expect(prompt).not.toContain('WRONG_BLOCK_SECRET');
 expect(callAIJSON.mock.calls[0][6]).toMatchObject({timeoutMs:45000,bridgePurpose:'lecture-questions'});
});
it('withholds multi-question coaching instead of presenting a whole worksheet',()=>{
 expect(safeCoachTurn({feedback:'Start here.',question:'Where does it enter? Where does it cross?'},question)).toBeNull();
});
