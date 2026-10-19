import { beforeEach, expect, it, vi } from 'vitest';
const cloud=vi.hoisted(()=>({data:{},writes:[]}));
vi.mock('./cloudBase.js',()=>({readCloud:(_u,k,f)=>cloud.data[k]||f,writeCloudAwait:async(_u,k,v)=>{cloud.data[k]=v;cloud.writes.push(v);},isHydrated:()=>true,readError:()=>null,subscribeToCloudStore:()=>()=>{}}));
import * as figures from './questionFigures.js';
beforeEach(()=>{cloud.data={};cloud.writes=[];});
it('saves account crop URLs and reloads multiple source figures without overwriting',async()=>{
 const a={stem:'First image question',sourceFile:'Homework.pdf'},b={...a,stem:'Second image question'};
 await figures.save('learner',a,{url:'https://example.com/a.jpg',page:2});
 await figures.save('learner',b,{url:'https://example.com/b.jpg',page:3});
 const restored=await figures.load('learner','Homework.pdf');
 expect(figures.apply({...a,questionId:'new-session'},restored).sourceImageUrl).toBe('https://example.com/a.jpg');
 expect(Object.keys(restored)).toHaveLength(2);
 expect(JSON.stringify(cloud.writes)).not.toContain('data:image');
});
