// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ExamPreparationStatus } from "./ExamPreparationStatus.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("does not invite answering at zero and shows real stage, elapsed time and checked lectures", () => {
  const host = document.createElement("div"), root = createRoot(host);
  const session = { questions: [], targetQuestionCount: 50, fillStartedAt: Date.now()-120000, fillProgress: { updatedAt: Date.now()-100000, activeLectures: ["Reviewing accuracy: NB 07"], completedLectures: 2, totalLectures: 20, failedLectures: 1 } };
  act(() => root.render(<ExamPreparationStatus session={session} />));
  expect(host.textContent).toContain("0/50 questions ready");
  expect(host.textContent).toContain("You can browse RxTrack while preparation continues");
  expect(host.textContent).toContain("closing or reloading the tab interrupts");
  expect(host.textContent).toContain("nothing to answer yet");
  expect(host.textContent).toContain("Reviewing accuracy: NB 07");
  expect(host.textContent).toContain("2/20 lectures checked");
  expect(host.textContent).toContain("No new progress has been confirmed");
  act(() => root.render(<ExamPreparationStatus session={{ ...session, questions: [{}] }} />));
  expect(host.textContent).toContain("You can answer the ready questions");
  act(() => root.unmount());
});
