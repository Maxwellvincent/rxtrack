import { beforeEach, expect, it } from "vitest";
import { installDomStorage } from "./testEnv.js";
import * as figures from "./questionFigures.js";
beforeEach(()=>installDomStorage());
it("persists a question-specific crop and reuses it across session IDs",async()=>{
 const q={id:'q4',sourceFile:'IMCQ.pdf',stem:'A CT image is shown. Which side is affected?',sourceImageUrl:'https://example.com/page.jpg'};
 await figures.save(null,q,{url:'https://example.com/crop.jpg',page:7,selection:{x:.2,y:.3,w:.4,h:.4}});
 const records=await figures.load(null,'IMCQ');
 const reused=figures.apply({...q,questionId:'new-session-q'},records);
 expect(reused).toMatchObject({sourceImageUrl:'https://example.com/crop.jpg',originalSourceImageUrl:'https://example.com/page.jpg',sourceVisualPage:7,sourceFigureCropped:true});
 expect(figures.apply({...q,stem:'Another unrelated question'},records).sourceImageUrl).toBe(q.sourceImageUrl);
});
it("does not overwrite another question crop in the same source",async()=>{
 const a={sourceFile:'Homework.pdf',stem:'First question?'},b={...a,stem:'Second question?'};
 await figures.save(null,a,{url:'https://example.com/a.jpg',page:1});
 await figures.save(null,b,{url:'https://example.com/b.jpg',page:2});
 const saved=figures.read(null,a.sourceFile);
 expect(Object.keys(saved)).toHaveLength(2);
 expect(figures.apply(a,saved).sourceImageUrl).toContain('/a.jpg');
 expect(figures.apply(b,saved).sourceImageUrl).toContain('/b.jpg');
});
it("reuses a source-question crop after OCR or attribution wording changes",async()=>{
 const original={sourceFile:'Homework.pdf',sourceSection:'NB 28',sourceQuestionNumber:17,sourcePage:18,stem:'Which labeled site? Underlying schematic from Textbook.'};
 await figures.save(null,original,{url:'https://example.com/stable.jpg',page:18});
 const revised={...original,stem:'Which labeled site carries pain?'};
 expect(figures.apply(revised,figures.read(null,original.sourceFile)).sourceImageUrl).toBe('https://example.com/stable.jpg');
});
it("still finds legacy stem-keyed crops for imported questions that gain stable metadata",()=>{
 const legacy={sourceFile:'Homework.pdf',stem:'Exact old stem'};
 const records={[figures.figureIdentity(legacy)]:{url:'https://example.com/legacy.jpg',page:2}};
 const enriched={...legacy,sourceSection:'NB 1',sourceQuestionNumber:3,sourcePage:2};
 expect(figures.apply(enriched,records).sourceImageUrl).toBe('https://example.com/legacy.jpg');
});
it('persists explicit diagram label confirmation without losing the saved crop',async()=>{
 const q={sourceFile:'NB.pdf',stem:'Which marked site?',choices:{A:'Visual option A',B:'Visual option B'},sourceVisualChoicesUnverified:true};
 await figures.save(null,q,{url:'https://example.com/selected.jpg',page:4});
 await figures.save(null,q,{visualLastLabel:'H'});
 const applied=figures.apply(q,figures.read(null,q.sourceFile));
 expect(applied.sourceImageUrl).toContain('selected.jpg');expect(applied.sourceVisualLabelsConfirmed).toBe(true);
 expect(Object.keys(applied.choices)).toHaveLength(8);
 expect(figures.apply({...q,choices:{A:'Actual text',B:'Other text'}},figures.read(null,q.sourceFile)).choices.A).toBe('Actual text');
 const expanded=figures.apply({...q,choices:{A:'Visual option A',Z:'Visual option Z'}},figures.read(null,q.sourceFile));
 expect(expanded.choices.Z).toBe('Visual option Z');expect(expanded.sourceVisualLabelsConfirmed).not.toBe(true);
});
