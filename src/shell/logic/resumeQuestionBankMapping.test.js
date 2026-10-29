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
 expect(second).toMatchObject({status:'complete',error:null,evaluated:2,linked:3});
 expect(classify).toHaveBeenCalledTimes(3);
 expect(classify.mock.calls[2][0].id).toBe('q2');
 expect(bank.file[2].curriculumLinkStatus).toBe('user-confirmed');
});
it('persists unavailable bridge failures without editing originals',async()=>{
 const bank={f:[{id:'q',correct:'A'}]};let metadata={m:{filename:'f',blockId:'b'}};const writeBanks=vi.fn();
 const result=await resumeQuestionBankMapping({userId:'u',blockId:'b',filename:'f'},{readBanks:()=>bank,writeBanks,readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},bridgeAvailable:async()=>false});
 expect(result.status).toBe('paused');expect(metadata.m.mappingProgress.error).toContain('bridge unavailable');expect(writeBanks).not.toHaveBeenCalled();
});
