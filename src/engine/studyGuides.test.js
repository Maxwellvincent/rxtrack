import {it,expect,vi} from 'vitest';
import {lectureScopes,normalizeStudyGuide,selectGuideRows,studyGuidePrompt,mergeStudyGuide} from './studyGuides.js';
const guideStore=vi.hoisted(()=>({load:vi.fn()}));
vi.mock('../stores/studyGuides.js',()=>guideStore);
import {generateMcqs,buildMcqPrompt,auditGeneratedQuestions} from './mcq.js';
const row={page:2,table:1,row:1,section:'10. Cerebellum (NB 37, DLA 08)',heading:'Functional zones',headers:['Zone','Deficit'],cells:['Lateral cerebellar hemisphere','Planning accuracy and timing of movements'],label:'Lateral cerebellar hemisphere',notes:'Preserve laterality and negative findings.',context:'Lesion comparison',held:false};
const raw={format:'rxtrack-study-guide',version:1,sourceVersion:'v1',pageCount:4,rows:[row]};
const cfg={subject:'NB 37 Cerebellum',objectives:[{id:'o37',objective:'Explain cerebellar planning and timing of movements.'}]};
const catalog=()=>mergeStudyGuide({},normalizeStudyGuide(raw));
it('preserves ranges, lists and separate DLA numbering',()=>{expect(lectureScopes('NB 27–30, 38, 45, 54; DLA 08–09')).toEqual(['NB27','NB28','NB29','NB30','NB38','NB45','NB54','DLA8','DLA9']);});
it('preserves full columns, notes and page provenance; repeated import replaces only the same source version',()=>{
 const g=normalizeStudyGuide({...raw,rows:[row,row]});expect(g.rows).toHaveLength(1);expect(g.rows[0]).toMatchObject({cells:row.cells,notes:row.notes,page:2,status:'candidate'});
 expect(Object.keys(mergeStudyGuide(mergeStudyGuide({},g),g).guides)).toHaveLength(1);
 expect(Object.keys(mergeStudyGuide(mergeStudyGuide({},g),normalizeStudyGuide({...raw,sourceVersion:'v2'})).guides)).toHaveLength(2);
});
it('rejects malformed extracts and holds missing scope or ambiguous cells',()=>{
 expect(()=>normalizeStudyGuide({...raw,rows:[{...row,cells:['missing column']}]})).toThrow();
 expect(normalizeStudyGuide({...raw,rows:[{...row,section:'Unassigned'}]}).rows[0].held).toBe(true);
 expect(selectGuideRows(mergeStudyGuide({},normalizeStudyGuide({...raw,rows:[{...row,held:true}]})),cfg)).toEqual([]);
});
it('retrieves only lecture-scoped objective matches, without keyword-only cross-lecture guessing',()=>{
 expect(selectGuideRows(catalog(),cfg)).toHaveLength(1);
 expect(selectGuideRows(catalog(),{...cfg,subject:'NB 35 PNS'})).toEqual([]);
 expect(selectGuideRows(catalog(),{...cfg,subject:'Cerebellum'})).toEqual([]);
 expect(selectGuideRows(catalog(),{...cfg,objectives:[{id:'x',objective:'Explain auditory transduction'}]})).toEqual([]);
});
it('uses explicit row lecture columns instead of assigning every numerical rule to all lectures',()=>{
 const guide=normalizeStudyGuide({...raw,rows:[{...row,section:'Equations',headers:['Rule','Lecture / use'],cells:['Planning timing','NB 37: cerebellar planning']}]});
 expect(guide.rows[0].scopes).toEqual(['NB37']);
});
it('bounds retrieval without truncating a row and balances matched objectives',()=>{
 const rows=Array.from({length:25},(_,i)=>({...row,row:i+1,cells:[...row.cells.slice(0,1),i%2?'Visual retinal refraction accommodation':'Planning accuracy and timing of movements']}));
 const config={...cfg,objectives:[...cfg.objectives,{id:'v',objective:'Explain visual retinal accommodation refraction'}]};
 const picked=selectGuideRows(mergeStudyGuide({},normalizeStudyGuide({...raw,rows})),config,6);
 expect(picked.length).toBeLessThanOrEqual(6);expect(new Set(picked.map(r=>r.objectiveId)).size).toBe(2);expect(studyGuidePrompt(picked).length).toBeLessThan(8000);
});
it('includes supporting comparisons in writer prompts without making them answer evidence or objective credit',()=>{
 const selected=selectGuideRows(catalog(),cfg),prompt=buildMcqPrompt({...cfg,lectureText:'Original lecture supports cerebellar timing.',studyGuideRows:selected});
 expect(prompt).toContain('Lateral cerebellar hemisphere');expect(prompt).toContain('NOT factual authority');expect(prompt).toContain('no');
 expect(selected[0].sourceRelationshipIds).toBeUndefined();
});
it('keeps supplementary claims out of independent answer review',async()=>{
 const review=vi.fn().mockResolvedValue({reviews:[]});
 await auditGeneratedQuestions([{stem:'Original source question?',choices:{A:'x',B:'y'},correct:'A',objectiveIds:['o37']}],{...cfg,lectureText:'Original lecture source.',studyGuideRows:[{...row,cells:['PRIVATE_GUIDE_ONLY']}],requireBlindKeyCheck:true},{blindSourceReview:true,reviewAIJSON:review});
 expect(review.mock.calls[0][1]).not.toContain('PRIVATE_GUIDE_ONLY');
});

it('loads the block guide at the shared lecture/exam generation boundary and stops on source sync failure',async()=>{
 guideStore.load.mockResolvedValue(catalog());const writer=vi.fn().mockResolvedValue({questions:[]});
 await generateMcqs({...cfg,userId:'u',blockId:'b',lectureText:'Original cerebellar lecture evidence. '.repeat(20),count:1},{callAIJSON:writer});
 expect(guideStore.load).toHaveBeenCalledWith('u','b');expect(writer.mock.calls[0][1]).toContain('Lateral cerebellar hemisphere');
 writer.mockClear();guideStore.load.mockRejectedValue(new Error('offline'));
 const result=await generateMcqs({...cfg,userId:'u',blockId:'b'},{callAIJSON:writer});
 expect(result.failureKind).toBe('source_sync');expect(writer).not.toHaveBeenCalled();
});
