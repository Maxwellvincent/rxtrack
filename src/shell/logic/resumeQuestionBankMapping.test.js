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
it('re-evaluates earlier unresolved questions when the lecture/objective catalog has changed',async()=>{
 let bank={f:[{id:'q',stem:'Which EEG feature?',correct:'A',choices:{A:'Spindles',B:'Alpha'}},{id:'ok',correct:'A',curriculumLinkStatus:'evidence-verified',objectiveIds:['x']}]};
 let metadata={m:{filename:'f',blockId:'b',mappingProgress:{status:'paused',version:6,completedQuestionKeys:['q','ok'],catalogSignature:'stale'}}};
 const classify=vi.fn(async()=>({objectiveIds:['o61'],curriculumLinkStatus:'evidence-verified'}));
 const deps={readBanks:()=>bank,writeBanks:async(_,v)=>{bank=v},readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},classify,bridgeAvailable:async()=>true,fetchLectureContent:async()=>({chunks:[{text:'Sleep spindles mark stage 2.'}]}),review:vi.fn()};
 const args={userId:'u',blockId:'b',filename:'f',lectures:[{id:'l61',blockId:'b',lectureTitle:'NB 61 Sleep'}],objectives:[{id:'o61',linkedLecId:'l61',blockId:'b',objective:'Contrast sleep stages using EEG'}]};
 const result=await resumeQuestionBankMapping(args,deps);
 expect(classify).toHaveBeenCalledTimes(1);
 expect(classify.mock.calls[0][0].id).toBe('q');
 expect(result.status).toBe('complete');
 expect(result.catalogSignature).not.toBe('stale');
 classify.mockClear();
 bank.f[0]={...bank.f[0],curriculumLinkStatus:undefined};
 metadata.m.mappingProgress={...metadata.m.mappingProgress,status:'paused'};
 await resumeQuestionBankMapping(args,deps);
 expect(classify).not.toHaveBeenCalled();
});
it('keeps a lecture the learner pinned and only accepts objective links within it',async()=>{
 let bank={f:[{id:'a',stem:'Pinned elsewhere',correct:'A',choices:{A:'x',B:'y'},lectureId:'l55',lectureLabel:'NB 55',lectureLinkBasis:'user-assigned',curriculumLinkStatus:'user-lecture-only',objectiveIds:[]},
  {id:'b',stem:'Pinned same',correct:'A',choices:{A:'x',B:'y'},lectureId:'l55',lectureLabel:'NB 55',lectureLinkBasis:'user-assigned',curriculumLinkStatus:'user-lecture-only',objectiveIds:[]}]};
 let metadata={m:{filename:'f',blockId:'b'}};
 const classify=vi.fn(async q=>{expect(q.lectureId).toBe('l55');return q.id==='a'
  ?{lectureId:'l40',lectureLabel:'NB 40',objectiveIds:['o40'],curriculumLinkStatus:'evidence-verified',lectureLinkBasis:'two-pass-source-verified'}
  :{lectureId:'l55',lectureLabel:'NB 55',objectiveIds:['o55'],curriculumLinkStatus:'evidence-verified',lectureLinkBasis:'two-pass-source-verified'};});
 const deps={readBanks:()=>bank,writeBanks:async(_,v)=>{bank=v},readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},classify,bridgeAvailable:async()=>true,fetchLectureContent:async()=>({}),review:vi.fn()};
 await resumeQuestionBankMapping({userId:'u',blockId:'b',filename:'f',lectures:[{id:'l55',blockId:'b',lectureTitle:'NB 55'},{id:'l40',blockId:'b',lectureTitle:'NB 40'}],objectives:[]},deps);
 expect(bank.f[0]).toMatchObject({lectureId:'l55',lectureLinkBasis:'user-assigned',curriculumLinkStatus:'user-lecture-only',objectiveIds:[]});
 expect(bank.f[0].curriculumMappingReview.reason).toMatch(/your assigned lecture/i);
 expect(bank.f[1]).toMatchObject({lectureId:'l55',lectureLinkBasis:'user-assigned',curriculumLinkStatus:'evidence-verified',objectiveIds:['o55']});
});
it('applies headings learned from the learner across the block and passes similar precedents to the reviewer',async()=>{
 let bank={hw15:[
  {id:'mine',stem:'Patient with depersonalization episodes. Diagnosis?',correct:'A',choices:{A:'x',B:'y'},sourceSectionTitle:'Dissociative Disorders',lectureId:'l58',lectureLabel:'NB 58',lectureLinkBasis:'user-assigned',curriculumLinkStatus:'user-confirmed',objectiveIds:['o58']},
  {id:'open',stem:'Patient with dissociative amnesia after trauma. Diagnosis?',correct:'A',choices:{A:'x',B:'y'},sourceSectionTitle:'Dissociative Disorders'}],
  other:[{id:'x',stem:'Unrelated',correct:'A',choices:{A:'x'},sourceSectionTitle:'Dissociative Disorders',lectureId:'l58',lectureLinkBasis:'user-assigned',curriculumLinkStatus:'user-lecture-only',objectiveIds:[]}]};
 let metadata={m:{filename:'hw15',blockId:'b'},n:{filename:'other',blockId:'b'}};
 const classify=vi.fn(async(q,{precedents})=>{expect(q.lectureId).toBe('l58');expect(q.lectureLinkBasis).toBe('learned-heading');expect(precedents[0]).toMatchObject({lectureId:'l58',objectiveIds:['o58']});return null;});
 const deps={readBanks:()=>bank,writeBanks:async(_,v)=>{bank=v},readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},classify,bridgeAvailable:async()=>true,fetchLectureContent:async()=>({}),review:vi.fn()};
 await resumeQuestionBankMapping({userId:'u',blockId:'b',filename:'hw15',lectures:[{id:'l58',blockId:'b',lectureTitle:'NB 58'}],objectives:[]},deps);
 expect(classify).toHaveBeenCalledTimes(1);
 expect(bank.hw15[1]).toMatchObject({lectureId:'l58',lectureLinkBasis:'learned-heading',curriculumLinkStatus:'user-lecture-only'});
});
it('maps a CBSE-filed bank against its home block and looks at the focus week first',async()=>{
 const lectureText={l1:'Major depressive disorder: anhedonia, depressed mood, sleep change, guilt, suicidal ideation; SSRIs first line.',l2:'Schizophrenia: hallucinations, delusions, disorganized speech; dopamine antagonists.'};
 let bank={f:[{id:'q1',stem:'A woman has anhedonia, guilt and early waking for weeks. Diagnosis?',correct:'A',choices:{A:'Major depressive disorder',B:'Schizophrenia'}},
  {id:'q2',stem:'A man with anhedonia, depressed mood and guilt after his job loss; which first line drug?',correct:'A',choices:{A:'SSRI',B:'Haloperidol'}}]};
 let metadata={m:{filename:'f',blockId:'cbse-prep'}};
 const classify=vi.fn(async(q,{blockId,focusLectureIds})=>{expect(blockId).toBe('nb3');expect(focusLectureIds[0]).toBe('l1');return null;});
 const deps={readBanks:()=>bank,writeBanks:async(_,v)=>{bank=v},readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},classify,bridgeAvailable:async()=>true,
  fetchLectureContent:async(_,id)=>({chunks:[{text:lectureText[id]}]}),review:vi.fn()};
 const lectures=[{id:'l1',blockId:'nb3',lectureTitle:'NB 59 Depressive Disorders',lectureDate:'2026-11-18'},{id:'l2',blockId:'nb3',lectureTitle:'NB 66 Schizophrenia',lectureDate:'2026-11-25'}];
 const result=await resumeQuestionBankMapping({userId:'u',blockId:'cbse-prep',filename:'f',recheck:true,lectures,objectives:[],scope:{homeBlockId:'nb3',focusLectureIds:['l1'],focusWeeks:['2026-11-20'],format:'imcq'}},deps);
 expect(classify).toHaveBeenCalledTimes(2);
 expect(result.scope).toMatchObject({homeBlockId:'nb3',filedBlockId:'cbse-prep'});
 expect(bank.f[0].lectureId).toBe('l1');
 expect(bank.f[0].objectiveIds).toBeUndefined();
});
it('week rescue runs without AI when aiMapping is off',async()=>{
 let bank={f:[{id:'q1',stem:'Anhedonia, guilt and depressed mood for weeks with anhedonia. Diagnosis?',correct:'A',choices:{A:'Major depressive disorder',B:'Schizophrenia'}}]};
 let metadata={m:{filename:'f',blockId:'nb3'}};
 const bridgeAvailable=vi.fn(async()=>false);
 const deps={readBanks:()=>bank,writeBanks:async(_,v)=>{bank=v},readMeta:()=>metadata,writeMeta:async(_,v)=>{metadata=v},bridgeAvailable,
  fetchLectureContent:async()=>({chunks:[{text:'Major depressive disorder: anhedonia, depressed mood, guilt.'}]})};
 const result=await resumeQuestionBankMapping({userId:'u',blockId:'nb3',filename:'f',lectures:[{id:'l1',blockId:'nb3',lectureTitle:'NB 59 Depressive Disorders'},{id:'l2',blockId:'nb3',lectureTitle:'NB 66 Schizophrenia'}],objectives:[],aiMapping:false,scope:{homeBlockId:'nb3',focusLectureIds:['l1','l2']}},deps);
 expect(bridgeAvailable).not.toHaveBeenCalled();
 expect(result.status).toBe('complete');
 expect(bank.f[0]).toMatchObject({lectureId:'l1',lectureLinkBasis:'bank-week-content',curriculumLinkStatus:'content-matched'});
 expect(result.weekRescued).toBe(1);
});
