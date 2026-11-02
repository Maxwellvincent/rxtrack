import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
const mocks = vi.hoisted(() => ({error:null,refresh:vi.fn(),history:{answered:100,correct:72}}));
vi.mock("./SchoolAlignmentPanel.jsx",()=>({SchoolAlignmentPanel:()=>null}));
vi.mock("../../hooks/useQuestionPractice.js",()=>({useQuestionPractice:()=>({studyAnswers:[],sessions:[],manualEntries:[],historicalStudy:mocks.history,loading:false,error:mocks.error,refresh:mocks.refresh})}));
import { BlockPracticeCard } from "./BlockPracticeCard.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(()=>{installDomStorage();mocks.error=null;mocks.history={answered:100,correct:72};mocks.refresh.mockReset();});
async function mount() {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => { root.render(<BlockPracticeCard blockId="er" userId="u" />); });
  return { host, root };
}
describe("Block practice card", () => {
  it("shows the recorded total, weighted accuracy and a separate 80% target", async () => {
    const { host, root } = await mount();
    expect(host.textContent).toContain("72.0%");
    expect(host.textContent).toContain("72 correct of 100 scored");
    expect(host.textContent).toContain("8.0 percentage points below");
    expect(host.textContent).toContain("80%");
    expect(host.textContent).toContain("not a predicted school-exam grade");
    expect(host.querySelector("details").open).toBe(false);
    await act(async () => { root.unmount(); });
  });
  it("explicitly labels partial results when exam history fails and allows retry", async () => {
    mocks.error=new Error("offline");
    const { host, root } = await mount();
    expect(host.querySelector('[role="alert"]').textContent).toContain("totals may be incomplete");
    await act(async () => { host.querySelector("button").click(); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
