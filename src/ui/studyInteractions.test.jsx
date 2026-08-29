import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import { LabAnnotatedText } from "./LabValue.jsx";
import { applyRangeHighlights, highlightRanges } from "./highlightRanges.js";
import { advanceOnEnter } from "./nextQuestion.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => installDomStorage());
it("marks only the selected occurrence, and migrates old phrases once", () => {
  const text = "clue and clue";
  const parts = applyRangeHighlights([{type:"text",content:text}], [{start:9,end:13}]);
  expect(parts).toMatchObject([{type:"text",content:"clue and "},{type:"mark",content:"clue"}]);
  expect(highlightRanges(text,["clue"])).toEqual([{start:0,end:4}]);
});
it("removes a selected highlight using click or keyboard", () => {
  const remove = vi.fn(); const host=document.createElement("div"); document.body.append(host); const root=createRoot(host);
  act(()=>root.render(<LabAnnotatedText text="clue and clue" highlights={[{start:9,end:13}]} onRemoveHighlight={remove} />));
  expect(host.querySelectorAll("mark")).toHaveLength(1);
  act(()=>host.querySelector("mark").click()); expect(remove).toHaveBeenCalledWith({start:9,end:13});
  act(()=>root.unmount()); host.remove();
});
it("advances only an eligible question and does not intercept typing or held Enter", () => {
  const advance=vi.fn();
  const e={key:"Enter",target:document.createElement("div"),preventDefault:vi.fn(),stopPropagation:vi.fn()};
  advanceOnEnter(e,advance,false); advanceOnEnter({...e,repeat:true},advance,true);
  advanceOnEnter({...e,target:document.createElement("textarea")},advance,true);
  expect(advance).not.toHaveBeenCalled(); advanceOnEnter(e,advance,true); expect(advance).toHaveBeenCalledOnce();
});
