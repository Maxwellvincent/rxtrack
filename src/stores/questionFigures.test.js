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
