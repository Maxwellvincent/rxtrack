// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TopicPractice } from "./TopicPractice.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("finds topic objectives in the block and launches focused repair practice", async () => {
  const lectures = [{ id: "bs", blockId: "nb2", lectureTitle: "NB 40 Brainstem Blood Supply", atoms: [{ term: "Wallenberg", content: "Posterior inferior cerebellar artery occlusion", objectiveIds: ["o2"] }] }];
  const objectives = [{ id: "o1", linkedLecId: "bs", objective: "Describe deficits of medial medullary lesions" }, { id: "o2", linkedLecId: "bs", objective: "Localize lateral brainstem vascular lesions" }];
  const onPractice = vi.fn();
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<TopicPractice blockId="nb2" userId="u" lectures={lectures} objectives={objectives} onPractice={onPractice} fetchContent={async () => ({ chunks: [{ markdown: "Medial medullary syndrome follows anterior spinal artery occlusion." }] })} />));
  const input = host.querySelector('input[aria-label="Topic to practice"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(input, "PICA lesions, medial medulla"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { host.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(host.textContent).toContain("Found in NB 40 Brainstem Blood Supply");
  await act(async () => { [...host.querySelectorAll("button")].find(b => /Practice 2 objectives/.test(b.textContent)).click(); });
  expect(onPractice).toHaveBeenCalledWith(expect.objectContaining({ studyMode: "repair", objectiveIds: expect.arrayContaining(["o1", "o2"]) }));
  expect(onPractice.mock.calls[0][0].focusNotes).toMatch(/PICA lesions, medial medulla/);
  root.unmount();
});
