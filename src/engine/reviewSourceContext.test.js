import {it,expect,vi} from 'vitest';
import {reviewModuleForBlock,reviewSourcePrompt} from './reviewSourceContext.js';
const fixture=vi.hoisted(()=>({terms:[],bridge:vi.fn()}));
vi.mock('../stores/terms.js',()=>({read:()=>fixture.terms}));
vi.mock('../stores/studyGuides.js',()=>({load:async()=>({guides:{}})}));
vi.mock('../llmBridge.js',async original=>({...await original(),bridgeReviewContext:fixture.bridge}));
import {generateMcqs,buildMcqPrompt,auditGeneratedQuestions} from './mcq.js';
it('uses exact account block identity rather than a filename or neighboring block',()=>{
 const terms=[{id:'t',subjects:[{name:'Neuro',blocks:[{id:'b2',name:'NB 2'},{id:'b1',name:'NB 1'}]}]}];
 expect(reviewModuleForBlock(terms,'b2')).toBe('NB2');expect(reviewModuleForBlock(terms,'b1')).toBeNull();expect(reviewModuleForBlock(terms,'unknown')).toBeNull();
});
it('supplies unverified teaching/examples only to writing and preserves their source role',async()=>{
 const context={status:'matched',units:[{id:'r',page:4,sourceFile:'Review',kind:'unkeyed-worked-example',keyStatus:'unverified',text:'PRIVATE_REVIEW_EXAMPLE'}]};
 const cfg={subject:'NB 37 Cerebellum',lectureText:'Original teaching evidence.',objectives:[{id:'o',objective:'Explain coordination'}],reviewSourceContext:context,requireBlindKeyCheck:true};
 expect(buildMcqPrompt(cfg)).toContain('PRIVATE_REVIEW_EXAMPLE');expect(reviewSourcePrompt(context)).toContain('NOT independent answer evidence');
 const review=vi.fn().mockResolvedValue({reviews:[]});await auditGeneratedQuestions([{stem:'Test?',correct:'A',choices:{A:'First',B:'Second'},objectiveIds:['o']}],cfg,{blindSourceReview:true,reviewAIJSON:review});
 expect(review.mock.calls[0][1]).not.toContain('PRIVATE_REVIEW_EXAMPLE');
});

it('automatically attaches local review context only for the signed-in NB2 block',async()=>{
 fixture.terms=[{blocks:[{id:'b',name:'NB 2'},{id:'other',name:'NB 1'}]}];fixture.bridge.mockResolvedValue({version:1,status:'matched',units:[{id:'r',text:'LOCAL_NB2_REVIEW',page:1,sourceFile:'review.pdf'}]});
 const writer=vi.fn().mockResolvedValue({questions:[]});const cfg={userId:'u',blockId:'b',subject:'NB 37 Cerebellum',objectives:[{id:'o',objective:'Explain coordination'}],lectureText:'Original lecture evidence and coordination relationships. '.repeat(8),count:1};
 await generateMcqs(cfg,{callAIJSON:writer});expect(fixture.bridge).toHaveBeenCalledWith('NB2',cfg.subject,cfg.objectives);expect(writer.mock.calls[0][1]).toContain('LOCAL_NB2_REVIEW');
 fixture.bridge.mockClear();writer.mockClear();await generateMcqs({...cfg,blockId:'other'},{callAIJSON:writer});expect(fixture.bridge).not.toHaveBeenCalled();expect(writer.mock.calls[0][1]).not.toContain('LOCAL_NB2_REVIEW');
});
