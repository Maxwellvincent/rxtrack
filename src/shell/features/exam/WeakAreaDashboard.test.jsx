import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { WeakAreaDashboard } from "./WeakAreaDashboard.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => installDomStorage());
const row = (id, extra = {}) => ({ lectureId:id, lecture:{id,lectureType:"LEC",lectureNumber:id === "one" ? 1 : 2,lectureTitle:`Lecture ${id}`}, totalQuestions:10,accuracy:.4,misses:6,recentCount:8,recentAccuracy:.5,priorityAccuracy:.5,objectiveTotal:4,objectivesTested:2,objectivesUntested:2,objectiveLinksMissing:false,strugglingObjectives:1,reportTopics:[],...extra });
function render(props) {
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 act(()=>root.render(<WeakAreaDashboard {...props}/>));
 return {host,click:text=>act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent.startsWith(text)).click()),done:()=>{act(()=>root.unmount());host.remove();}};
}
it("draws vertical accurate bars and keeps objective exposure separate",()=>{
 const ui=render({rows:[row("one")],priorityIds:["one"]});
 expect([...ui.host.querySelectorAll('[data-bar]')].map(bar=>bar.style.height)).toEqual(["50%","40%"]);
 ui.click("Objectives seen");
 expect(ui.host.querySelectorAll('[data-bar]')).toHaveLength(1);
 expect(ui.host.querySelector('[data-bar]').style.height).toBe("50%");
 expect(ui.host.textContent).toContain("Seen ≠ mastered");
 ui.done();
});
it("selects a lecture, shows its details and preserves the review handoff",()=>{
 const onReviewLecture=vi.fn();
 const ui=render({rows:[row("one"),row("two",{reportTopics:["Clinical topic"]})],priorityIds:["one","two"],onReviewLecture});
 act(()=>ui.host.querySelector('[aria-label^="Select LEC 2"]').click());
 expect(ui.host.querySelector('article').textContent).toContain("Lecture two");
 expect(ui.host.querySelector('article').textContent).toContain("Clinical topic");
 ui.click("Review & retest");
 expect(onReviewLecture).toHaveBeenCalledWith("two");
 ui.done();
});
it("distinguishes untested, insufficient recent data and missing links from zero percent",()=>{
 const ui=render({rows:[row("one",{totalQuestions:0,accuracy:null,recentCount:0,recentAccuracy:null}),row("two",{objectiveLinksMissing:true})],priorityIds:["two"]});
 ui.click("Not tested");
 expect(ui.host.querySelector('article').textContent).toContain("No graded practice yet");
 expect(ui.host.querySelectorAll('[data-bar]')).toHaveLength(0);
 ui.click("Missing links");ui.click("Objectives seen");
 expect(ui.host.querySelectorAll('[data-bar]')).toHaveLength(0);
 expect(ui.host.querySelector('article').textContent).toContain("links incomplete");
 ui.done();
});
it("shows genuine zero and 100 percent without manufactured minimum heights",()=>{
 const ui=render({rows:[row("one",{accuracy:0,recentAccuracy:1})],priorityIds:["one"]});
 expect([...ui.host.querySelectorAll('[data-bar]')].map(bar=>bar.style.height)).toEqual(["100%","0%"]);
 ui.done();
});

it("limits every chart view to six priorities and resets selection and page on filter change", () => {
 const rows=Array.from({length:14},(_,i)=>row(`l${i}`,{lecture:{id:`l${i}`,lectureType:"LEC",lectureNumber:i+1,lectureTitle:`Topic ${i+1}`}}));
 const ui=render({rows,priorityIds:rows.map(r=>r.lectureId)});
 const bars=()=>[...ui.host.querySelectorAll('[aria-label^="Select LEC"]')];
 expect(bars()).toHaveLength(6);
 expect(ui.host.textContent).toContain("Top 6 of 14 lectures");
 expect(ui.host.querySelector('.overflow-x-auto')).toBeNull();
 ui.click("Next six");
 expect(bars()).toHaveLength(6);
 expect(bars()[0].getAttribute("aria-label")).toContain("LEC 7");
 expect(bars()[0].getAttribute("aria-pressed")).toBe("true");
 ui.click("Next six"); expect(bars()).toHaveLength(2);
 ui.click("All lectures"); expect(bars()).toHaveLength(6);
 expect(bars()[0].getAttribute("aria-label")).toContain("LEC 1");
 ui.click("Next six"); ui.click("Objectives seen");
 expect(ui.host.textContent).toContain("Top 6 of 14 lectures");
 expect(ui.host.querySelectorAll('[data-bar]')).toHaveLength(6);
 ui.done();
});
