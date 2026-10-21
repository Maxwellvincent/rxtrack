// @vitest-environment jsdom
import React,{act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
const save=vi.fn();
vi.mock("../stores/learnerEvidence.js",()=>({recordLearningNote:(...args)=>save(...args)}));
import {LearningGapNote} from "./LearningGapNote.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
it("keeps a learning note editable after a failed save and confirms only a successful retry",async()=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<LearningGapNote userId="u" blockId="NB" lectureId="l" question={{id:"q",objectiveIds:["o"]}}/>));
 const input=host.querySelector("textarea");
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"I confuse V2 with V3");input.dispatchEvent(new Event("input",{bubbles:true}));});
 save.mockRejectedValueOnce(new Error("offline"));
 await act(async()=>host.querySelector("button").click());
 expect(host.textContent).toContain("Could not confirm");expect(input.value).toBe("I confuse V2 with V3");
 save.mockResolvedValueOnce({});await act(async()=>host.querySelector("button").click());
 expect(host.textContent).toContain("Learning point saved");expect(save.mock.calls[1][1]).toMatchObject({objectiveIds:["o"],lectureId:"l",note:"I confuse V2 with V3"});
 act(()=>root.unmount());host.remove();
});
