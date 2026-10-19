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
