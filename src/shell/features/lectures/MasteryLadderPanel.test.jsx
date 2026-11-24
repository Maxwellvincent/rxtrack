// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { MasteryLadderPanel } from "./MasteryLadderPanel.jsx";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it("shows each objective's rung with symbols and the next step", async () => {
  const at = Date.UTC(2026, 10, 20);
  const a = (n, extra) => ({ questionKey: `q${n}`, correct: true, at: at + n, reasoningVerified: true, orderLevel: "second-order", taskType: "clinical-application", ...extra });
  const evidence = { objectives: { o1: { recentFreshAnswers: [a(1, { orderLevel: "first-order" }), a(2), a(3)] } } };
  const objectives = [{ id: "o1", objective: "Differentiate bipolar I from bipolar II" }, { id: "o2", objective: "Describe lithium side effects" }];
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<MasteryLadderPanel objectives={objectives} evidence={evidence} now={at + 10} />));
  expect(host.textContent).toContain("0/2 mastered");
  expect(host.textContent).toContain("◑ Application");
  expect(host.textContent).toContain("Next: Look-alike discrimination");
  expect(host.textContent).toContain("○ Unseen");
  root.unmount();
});
