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
 expect(host.textContent).toContain("Ready for retest");expect(host.textContent).toContain("another session");
 act(()=>[...host.querySelectorAll("button")].find(button=>button.textContent.includes("Fresh 4-question")).click());
 expect(onRetest).toHaveBeenCalledWith({objectives,count:4});
 act(()=>[...host.querySelectorAll("button")].find(button=>button.textContent.includes("consolidate notes")).click());expect(onReviewNotes).toHaveBeenCalled();
 act(()=>root.render(<ObjectiveLearningReport objectives={objectives} evidence={evidence} records={[]}/>));expect(host.textContent).toBe("");
 act(()=>root.unmount());
});
