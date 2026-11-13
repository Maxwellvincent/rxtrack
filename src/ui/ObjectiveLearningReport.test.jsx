// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
import {ObjectiveLearningReport} from "./ObjectiveLearningReport.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it("explains progress and launches a bounded retest for unresolved practiced objectives",()=>{
 const host=document.createElement("div");const root=createRoot(host);const onRetest=vi.fn();const onReviewNotes=vi.fn();
 const objectives=[{id:"o",objective:"Explain the supplied nerve relationship"}];
 const evidence={objectives:{o:{attempts:3,correct:3,recent:[true,true,true],sessions:["first"],taskTypes:{recognition:1,mechanism:2}}}};
 act(()=>root.render(<ObjectiveLearningReport objectives={objectives} evidence={evidence} records={[{objectiveIds:["o"],correct:true,learningContext:{sourceCue:"Exact supplied lecture relationship."}}]} onRetest={onRetest} onReviewNotes={onReviewNotes}/>));
 expect(host.textContent).toContain("No unresolved misses");
 expect(host.textContent).not.toContain("Ready for retest");
 act(()=>[...host.querySelectorAll("button")].find(button=>button.textContent.includes("Show all practiced")).click());
 expect(host.textContent).toContain("Ready for retest");expect(host.textContent).toContain("another session");
 act(()=>[...host.querySelectorAll("button")].find(button=>button.textContent.includes("Fresh 4-question")).click());
 expect(onRetest).toHaveBeenCalledWith({objectives,count:4});
 act(()=>[...host.querySelectorAll("button")].find(button=>button.textContent.includes("consolidate notes")).click());expect(onReviewNotes).toHaveBeenCalled();
 act(()=>root.render(<ObjectiveLearningReport objectives={objectives} evidence={evidence} records={[]}/>));expect(host.textContent).toBe("");
 act(()=>root.unmount());
});
it("shows only missed objectives initially and keeps complete question detail behind an expansion",()=>{
 const host=document.createElement('div');const root=createRoot(host);
 const objectives=[{id:'miss',objective:'Contrast motor pathways'},{id:'right',objective:'Recall cortical outputs'}];
 const records=[{objectiveIds:['miss'],correct:false,learningContext:{topic:'UMN versus LMN',stem:'A patient has weakness. Which neuron?',choices:{A:'Upper motor neuron',B:'Lower motor neuron'},selected:'Upper motor neuron',keyed:'Lower motor neuron'}},{objectiveIds:['right'],correct:true}];
 act(()=>root.render(<ObjectiveLearningReport objectives={objectives} records={records}/>));
 expect(host.textContent).toContain('Contrast motor pathways');
 expect(host.textContent).toContain('UMN versus LMN');
 expect(host.textContent).not.toContain('Recall cortical outputs');
 const concepts=host.querySelector('[aria-label="Review concepts"]');expect(concepts.textContent).toContain('UMN versus LMN');expect(concepts.textContent).not.toContain('Contrast motor pathways');
 const detail=host.querySelector('details');expect(detail.open).toBe(false);
 expect(detail.textContent).toContain('A patient has weakness. Which neuron?');
 expect(detail.textContent).toContain('B. Lower motor neuron');
 act(()=>root.unmount());
});
it('offers the connected handoff after assisted success and preserves the requested reasoning depth',()=>{
 const host=document.createElement('div'),root=createRoot(host),onRetest=vi.fn();
 const objective={id:'o',blockId:'nb2',lectureId:'l',objective:'Explain pathway crossing'};
 act(()=>root.render(<ObjectiveLearningReport objectives={[objective]} onRetest={onRetest} records={[{at:Date.now()-1000,questionKey:'q',sessionKey:'s',objectiveIds:['o'],lectureId:'l',blockId:'nb2',correct:true,assisted:true,learningContext:{topic:'Pathway crossing'}}]}/>));
 expect(host.textContent).toContain('Fresh application next');
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Continue with'));
 act(()=>button.click());expect(onRetest.mock.calls[0][0].objectives[0]._transferOrder).toBe('second-order');
 expect(onRetest.mock.calls[0][0].focusNotes).toContain('Pathway crossing');
 expect(host.textContent).not.toContain('Fresh 4-question targeted retest');
 act(()=>root.unmount());
});
it('separates a correct current result from historical repairs and unsampled objectives',()=>{
 const host=document.createElement('div'),root=createRoot(host),now=Date.now();
 const objectives=[{id:'current',objective:'Current objective'},{id:'old',objective:'Historical objective'},{id:'untested',objective:'Untested objective'}];
 const records=[{eventId:'exam:new:q',at:now,questionKey:'new',sessionKey:'new',objectiveIds:['current'],correct:true}];
 const evidence={learningJournal:[{eventId:'exam:old:q',at:now-1000,questionKey:'old',sessionKey:'old',objectiveIds:['old'],correct:false,learningContext:{topic:'Old pathway'}}]};
 act(()=>root.render(<ObjectiveLearningReport objectives={objectives} evidence={evidence} records={records}/>));
 expect(host.textContent).toContain('No missed objectives in this session');
 expect(host.textContent).toContain('Historical repair queue');
 expect(host.textContent).toContain('Old pathway');
 expect(host.textContent).toContain('2 objectives were not sampled');
 act(()=>root.unmount());
});
