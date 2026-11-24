// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { HighYieldPanel } from "./HighYieldPanel.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("ranks lectures, shows evidence coverage with symbols and opens a lecture", async () => {
  const lectures = [{ id: "nb56", blockId: "b", lectureTitle: "NB 56 Anxiety" }, { id: "nb61", blockId: "b", lectureTitle: "NB 61 Sleep" }];
  const objectives = [{ id: "o", linkedLecId: "nb56", objective: "Apply the essential diagnostic criteria for anxiety disorders", status: "untested" }];
  const q = extra => ({ stem: "Which diagnosis?", correct: "A", choices: { A: "x" }, ...extra });
  const banks = [{ filename: "Week 15 homework", questions: [q({ objectiveIds: ["o"], lectureId: "nb56" }), q({}), q({})] }];
  const open = vi.fn();
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<HighYieldPanel blockId="b" blockName="NB 3" lectures={lectures} objectives={objectives} banks={banks} onOpenLecture={open} />));
  expect(host.textContent).toContain("High yield for NB 3");
  expect(host.textContent).toContain("⚠ 1 of 3 school questions are linked (33%)");
  expect(host.textContent).toContain("1. NB 56 Anxiety");
  expect(host.textContent).toContain("◇ Apply the essential diagnostic criteria for anxiety disorders (1 homework)");
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "Open lecture").click(); });
  expect(open).toHaveBeenCalledWith("nb56");
  root.unmount();
});
