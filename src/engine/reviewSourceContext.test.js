import {it,expect,vi} from 'vitest';
import {reviewModuleForBlock,reviewSourcePrompt} from './reviewSourceContext.js';
const fixture=vi.hoisted(()=>({terms:[],bridge:vi.fn()}));
vi.mock('../stores/terms.js',()=>({read:()=>fixture.terms}));
vi.mock('../stores/studyGuides.js',()=>({load:async()=>({guides:{}})}));
vi.mock('../stores/reviewLibrary.js',()=>({loadReviewContext:fixture.bridge}));
import {generateMcqs,generateFromAtoms,buildMcqPrompt,auditGeneratedQuestions} from './mcq.js';
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

it('automatically attaches shared review context only for the signed-in NB2 block',async()=>{
 fixture.terms=[{blocks:[{id:'b',name:'NB 2'},{id:'other',name:'NB 1'}]}];fixture.bridge.mockResolvedValue({version:1,status:'matched',units:[{id:'r',text:'LOCAL_NB2_REVIEW',page:1,sourceFile:'review.pdf'}]});
 const writer=vi.fn().mockResolvedValue({questions:[]});const cfg={userId:'u',blockId:'b',subject:'NB 37 Cerebellum',objectives:[{id:'o',objective:'Explain coordination'}],lectureText:'Original lecture evidence and coordination relationships. '.repeat(8),count:1};
 await generateMcqs(cfg,{callAIJSON:writer});expect(fixture.bridge).toHaveBeenCalledWith('u','b',{module:'NB2',subject:cfg.subject,objectives:cfg.objectives});expect(writer.mock.calls[0][1]).toContain('LOCAL_NB2_REVIEW');
 fixture.bridge.mockClear();writer.mockClear();await generateMcqs({...cfg,blockId:'other'},{callAIJSON:writer});expect(fixture.bridge).not.toHaveBeenCalled();expect(writer.mock.calls[0][1]).not.toContain('LOCAL_NB2_REVIEW');
});

it('attaches account source context before both MCQ and atom model transports',async()=>{
 fixture.terms=[{blocks:[{id:'b',name:'NB 2'}]}];fixture.bridge.mockResolvedValue({version:1,status:'matched',origin:'account-cloud',units:[{id:'r',text:'CLOUD_NB2_REVIEW',page:1,sourceFile:'review.pdf'}]});
 const cfg={userId:'u',blockId:'b',subject:'NB 37 Cerebellum',objectives:[{id:'o',objective:'Explain coordination'}],lectureText:'Original cerebellar evidence and movement coordination. '.repeat(10),count:1};
 for(const generate of [generateMcqs,generateFromAtoms]){const writer=vi.fn().mockResolvedValue({questions:[]});await generate({...cfg,atoms:[{term:'Coordination',content:'The cerebellar system coordinates movement and gait.'}]},{callAIJSON:writer});expect(writer.mock.calls[0][1]).toContain('CLOUD_NB2_REVIEW');}
});
