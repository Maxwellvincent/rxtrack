import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import ObjectiveTracker from "./ObjectiveTracker.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => installDomStorage());

function mount(ui) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    close() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

it("organizes objectives into an actionable readiness summary", () => {
  const view = mount(
    <ObjectiveTracker
      blockId="block-1"
      blockLectures={[{ id: "lec-1", lectureType: "LEC", lectureNumber: 1, lectureTitle: "Hormone signaling" }]}
      objectives={[
        { id: "obj-1", linkedLecId: "lec-1", objective: "Explain receptor signaling", status: "struggling" },
        { id: "obj-2", linkedLecId: "lec-1", objective: "Compare hormone classes", status: "untested" },
        { id: "obj-3", objective: "Describe feedback loops", status: "untested" },
      ]}
      onSelfRate={vi.fn()}
      onStartObjectiveQuiz={vi.fn()}
    />
  );

  expect(view.host.querySelector('[aria-label="Objective readiness summary"]')).not.toBeNull();
  expect(view.host.textContent).toContain("School objectives3");
  expect(view.host.textContent).toContain("Needs repair1");
  expect(view.host.textContent).toContain("Untested1");
  expect(view.host.textContent).toContain("Unlinked1");
  expect(view.host.textContent).toContain("Not quizzed");

  const repairMetric = [...view.host.querySelectorAll(".desk-objective-metric")]
    .find((button) => button.textContent.includes("Needs repair"));
  act(() => repairMetric.click());
  expect(view.host.textContent).toContain("Showing 1 struggling objectives");
  const lectureGroup = [...view.host.querySelectorAll('[role="button"]')]
    .find((button) => button.textContent.includes("Hormone signaling"));
  act(() => lectureGroup.click());
  expect(view.host.textContent).toContain("Explain receptor signaling");

  view.close();
});
