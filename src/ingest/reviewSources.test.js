// @vitest-environment jsdom
import {it,expect,vi,beforeEach} from 'vitest';
const bridge=vi.hoisted(()=>({bridgeReviewLibrary:vi.fn(async()=>null),bridgeReviewPdf:vi.fn()}));
vi.mock('../llmBridge.js',()=>bridge);
vi.mock('../examParser.js',()=>({loadPDFJS:vi.fn()}));
import {extractReviewFile,readableReviewText} from './reviewSources.js';
const text='The cerebellum coordinates movement and sensory feedback from the spinal cord. Lesion of the cerebellum causes impaired coordination.';
const file=(name,body)=>({name,size:body.length,arrayBuffer:async()=>new TextEncoder().encode(body).buffer});
beforeEach(()=>{bridge.bridgeReviewLibrary.mockClear();bridge.bridgeReviewPdf.mockReset();});
it('rejects garbled native text and accepts teaching prose',()=>{expect(readableReviewText('8LMW\u0004MW\u0004RSX'.repeat(30))).toBe(false);expect(readableReviewText(text)).toBe(true);});
it('stores supplementary text without inventing a key',async()=>{const p=await extractReviewFile(file('notes.txt',text));expect(p.units[0].held).toBe(false);expect(p.units[0].keyStatus).toBe('unverified');expect(p.module).toBe('NB2');});
it('deduplicates by exact file hash without a Mac or OCR',async()=>{const f=file('notes.txt',text),p=await extractReviewFile(f);const saved=await extractReviewFile({...f,name:'renamed.txt'},()=>{},[p]);expect(saved.alreadySaved).toBe(true);expect(bridge.bridgeReviewLibrary).not.toHaveBeenCalled();});
it('holds image-dependent examples out of text templates',async()=>{const p=await extractReviewFile(file('example.txt','Which structure in the figure shown below carries sensory information from the spinal cord to the cerebellum? The image is required for identification.'));expect(p.units[0].requiresFigure).toBe(true);});
it('rejects unreadable sources rather than storing fake evidence',async()=>{await expect(extractReviewFile(file('empty.txt','nothing'))).rejects.toThrow('No readable review text');});
it('uses local OCR for garbled PDF text and releases the document',async()=>{
 const destroy=vi.fn();window.pdfjsLib={getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'8LMW\u0004MW\u0004RSX'.repeat(30)}]})}),destroy})})};
 bridge.bridgeReviewPdf.mockResolvedValue([{page:1,text,method:'vision-local',confidence:0.9}]);
 const p=await extractReviewFile(file('review.pdf','%PDF-test'));expect(bridge.bridgeReviewPdf).toHaveBeenCalledOnce();expect(p.units[0].method).toBe('vision-local');expect(destroy).toHaveBeenCalledOnce();
});
