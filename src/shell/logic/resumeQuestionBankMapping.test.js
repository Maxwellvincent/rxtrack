import {it,expect,vi} from 'vitest';
import {resumeQuestionBankMapping} from './resumeQuestionBankMapping.js';
it('saves the provider failure and resumes after the durable per-question checkpoint',async()=>{
 let bank={file:[{id:'q1',stem:'One',correct:'A',choices:{A:'One',B:'Two'}},{id:'q2',stem:'Two',correct:'A',choices:{A:'One',B:'Two'}},{id:'done',correct:'A',curriculumLinkStatus:'user-confirmed'}]};
 let metadata={m:{filename:'file',blockId:'b'}};
 const classify=vi.fn().mockResolvedValueOnce({objectiveIds:['o'],curriculumLinkStatus:'evidence-verified'}).mockRejectedValueOnce(Error('ollama-cloud HTTP 402'));
 const deps={readBanks:()=>bank,writeBanks:async(_,v)=>{bank=v},readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},classify,bridgeAvailable:async()=>true,fetchLectureContent:async()=>({}),review:vi.fn()};
 const args={userId:'u',blockId:'b',filename:'file',lectures:[],objectives:[]};
 const first=await resumeQuestionBankMapping(args,deps);
 expect(first).toMatchObject({status:'paused',error:'ollama-cloud HTTP 402',currentQuestion:'q2',completedQuestionKeys:['q1']});
 expect(bank.file[0].correct).toBe('A');
 classify.mockResolvedValueOnce({objectiveIds:['p'],curriculumLinkStatus:'evidence-verified'});
 const second=await resumeQuestionBankMapping(args,deps);
 expect(second).toMatchObject({status:'complete',error:null,evaluated:2,linked:3,lastFailure:{reason:'ollama-cloud HTTP 402',questionKey:'q2'}});
 expect(classify).toHaveBeenCalledTimes(3);
 expect(classify.mock.calls[2][0].id).toBe('q2');
 expect(bank.file[2].curriculumLinkStatus).toBe('user-confirmed');
});
it('persists unavailable bridge failures without editing originals',async()=>{
 const bank={f:[{id:'q',correct:'A'}]};let metadata={m:{filename:'f',blockId:'b'}};const writeBanks=vi.fn();
 const result=await resumeQuestionBankMapping({userId:'u',blockId:'b',filename:'f'},{readBanks:()=>bank,writeBanks,readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},bridgeAvailable:async()=>false});
 expect(result.status).toBe('paused');expect(metadata.m.mappingProgress.error).toContain('bridge unavailable');expect(writeBanks).not.toHaveBeenCalled();
});
it('rechecks completed unresolved questions and saves source lecture attribution without objective credit',async()=>{
 let bank={f:[{id:'q',stem:'A source question',correct:'A',choices:{A:'One',B:'Two'},sourceSection:'NB 28',sourceSectionTitle:'Somatosensory System'},{id:'verified',correct:'A',curriculumLinkStatus:'evidence-verified',objectiveIds:['existing']}]};
 let metadata={m:{filename:'f',blockId:'b',mappingProgress:{status:'complete',completedQuestionKeys:['q'],evaluated:1}}};
 const classify=vi.fn(async(q,{onEvaluation})=>{expect(q.lectureId).toBe('l28');await onEvaluation({decision:'lecture-only',reason:'Objective catalog evidence still unresolved'});return null;});
 const deps={readBanks:()=>bank,writeBanks:async(_,v)=>{bank=v},readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},classify,bridgeAvailable:async()=>true,fetchLectureContent:async()=>({chunks:[{text:'The lecture teaches somatosensory processing.'}]}),review:vi.fn()};
 const args={userId:'u',blockId:'b',filename:'f',recheck:true,lectures:[{id:'l28',blockId:'b',lectureNumber:28,lectureTitle:'NB 28 Somatosensory System'}],objectives:[]};
 const result=await resumeQuestionBankMapping(args,deps);
 expect(classify).toHaveBeenCalledTimes(1);
 expect(bank.f[0]).toMatchObject({lectureId:'l28',curriculumLinkStatus:'source-label-matched',correct:'A'});
 expect(bank.f[0].objectiveIds).toBeUndefined();expect(bank.f[1].objectiveIds).toEqual(['existing']);
 expect(result).toMatchObject({linked:1,lectureLinked:1,unresolvedReasons:['Objective catalog evidence still unresolved']});
});
