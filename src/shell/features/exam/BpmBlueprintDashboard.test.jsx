import { expect, it } from 'vitest';
import { blueprintReadiness } from './BpmBlueprintDashboard.jsx';
it('summarizes recent linked evidence without presenting untested objectives as zero accuracy',()=>{
 const rows=blueprintReadiness(3,{l:[{id:'a',discipline:'ANAT'},{id:'b',discipline:'ANAT'},{id:'h',discipline:'HCB'}]},
  {objectives:{a:{attempts:20,correct:5,recent:[true,true,false,true]}}});
 expect(rows[0]).toMatchObject({accuracy:.75,practiced:1,untested:1,weak:1});
 expect(rows.find(r=>r.subject==='histology')).toMatchObject({accuracy:null,practiced:0,untested:1});
});
it('prioritizes low recorded accuracy ahead of untested objectives', async()=>{
 const {compareBlueprintReviewPriority}=await import('./BpmBlueprintDashboard.jsx');
 const items=[{id:'new',accuracy:null},{id:'half',accuracy:.5},{id:'low',accuracy:.2},{id:'secure',accuracy:.9}];
 expect(items.sort(compareBlueprintReviewPriority).map(o=>o.id)).toEqual(['low','half','new','secure']);
});

it('uses the same 80 percent repair boundary as the shared exam target',()=>{const rows=blueprintReadiness(4,{l:[{id:'o',discipline:'NSCI'}]},{objectives:{o:{attempts:4,correct:3,recent:[true,true,true,false]}}});expect(rows.find(row=>row.subject==='neuroscience').weak).toBe(1);});

it('requires an explicit school test before applying subject weights',async()=>{
 const React=await import('react'),{createRoot}=await import('react-dom/client'),{installDomStorage}=await import('../../../stores/testEnv.js');installDomStorage();globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const host=document.createElement('div'),root=createRoot(host);
 await React.act(async()=>root.render(React.createElement((await import('./BpmBlueprintDashboard.jsx')).BpmBlueprintDashboard,{userId:null,blockId:'nb2',objectivesByLecture:{},lectures:[]})));
 expect(host.querySelector('[aria-label="Dashboard test"]').value).toBe('');
 expect(host.querySelector('button').disabled).toBe(true);expect(host.textContent).toContain('No subject weighting selected');expect(host.textContent).not.toContain('Practice for Test 3');await React.act(async()=>root.unmount());
});
