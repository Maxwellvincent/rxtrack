import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import ObjectiveTracker, { buildUnlinkedSourceGroups } from "./ObjectiveTracker.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => installDomStorage());

it("groups unlinked DLA objectives and distinguishes missing activities from title mismatches", () => {
  const groups = buildUnlinkedSourceGroups(
    [
      { id: "a", activity: "DLA", lectureHint: "Glycolysis (Reading assignment)" },
      { id: "b", activity: "DLA", lectureHint: "Glycolysis (Reading assignment)" },
      { id: "c", activity: "DLA", lectureHint: "Overview metabolism fed fasting" },
    ],
    [{ id: "dla-2", lectureType: "DLA", lectureTitle: "Overview metabolism fed and fasting state" }]
  );

  expect(groups).toHaveLength(2);
  expect(groups.find((group) => group.hint.startsWith("Glycolysis"))).toMatchObject({ possibleMatch: false });
  expect(groups.find((group) => group.hint.startsWith("Overview"))).toMatchObject({ possibleMatch: true });
});

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
  const onStudyLecture = vi.fn();
  const view = mount(
    <ObjectiveTracker
      blockId="block-1"
      blockLectures={[{ id: "lec-1", lectureType: "LEC", lectureNumber: 1, lectureTitle: "Hormone signaling" }]}
      objectives={[
        { id: "obj-1", linkedLecId: "lec-1", objective: "Explain receptor signaling", status: "struggling" },
        { id: "obj-2", linkedLecId: "lec-1", objective: "Compare hormone classes", status: "untested" },
        { id: "obj-3", objective: "Describe feedback loops", status: "untested" },
      ]}
      learnerEvidence={{objectives:{"obj-1":{attempts:2,correct:0,recent:[false,false]}}}}
      onSelfRate={vi.fn()}
      onStartObjectiveQuiz={vi.fn()}
      onStudyLecture={onStudyLecture}
    />
  );

  expect(view.host.querySelector('[aria-label="Objective readiness summary"]')).not.toBeNull();
  expect(view.host.textContent).toContain("Active objectives2");
  expect(view.host.textContent).toContain("Needs repair1");
  expect(view.host.textContent).toContain("No answer evidence1");
  expect(view.host.textContent).toContain("Reference sources");
  expect(view.host.textContent).not.toContain("Unlinked1");
  expect(view.host.textContent).not.toContain("need lecture match");
  expect(view.host.textContent).toContain("Not quizzed");

  const repairMetric = [...view.host.querySelectorAll(".desk-objective-metric")]
    .find((button) => button.textContent.includes("Needs repair"));
  act(() => repairMetric.click());
  expect(view.host.textContent).toContain("Showing 1 struggling objectives");
  const lectureGroup = [...view.host.querySelectorAll('[role="button"]')]
    .find((button) => button.textContent.includes("Hormone signaling"));
  act(() => lectureGroup.click());
  expect(view.host.textContent).toContain("Explain receptor signaling");

  const lectureLink = [...view.host.querySelectorAll("button")]
    .find((button) => button.textContent.trim() === "Hormone signaling");
  act(() => lectureLink.click());
  expect(onStudyLecture).toHaveBeenCalledWith("lec-1");
  expect(view.host.textContent).toContain("Explain receptor signaling");

  view.close();
});

it("counts correct and incorrect linked question evidence as seen without promoting one correct answer to mastery", () => {
  const view = mount(
    <ObjectiveTracker
      blockId="block-1"
      blockLectures={[{ id: "lec-1", lectureType: "LEC", lectureNumber: 1, lectureTitle: "Hormone signaling" }]}
      objectives={[
        { id: "obj-seen", linkedLecId: "lec-1", objective: "Explain receptor signaling", status: "untested" },
        { id: "obj-missed", linkedLecId: "lec-1", objective: "Compare hormone classes", status: "untested" },
        { id: "obj-new", linkedLecId: "lec-1", objective: "Predict feedback", status: "untested" },
      ]}
      learnerEvidence={{ objectives: {
        "obj-seen": { attempts: 1, correct: 1, recent: [true], lastSeen: Date.now() },
        "obj-missed": { attempts: 3, correct: 0, recent: [false, false, false], lastSeen: Date.now() },
      } }}
      onSelfRate={vi.fn()}
      onStartObjectiveQuiz={vi.fn()}
    />
  );

  expect(view.host.textContent).toContain("No answer evidence1");
  expect(view.host.textContent).toContain("Developing1");
  expect(view.host.textContent).toContain("Needs repair1");
  const coverageTab = [...view.host.querySelectorAll("button")].find((button) => button.textContent.trim() === "Coverage");
  act(() => coverageTab.click());
  expect(view.host.textContent).toContain("2/3 seen");
  expect(view.host.textContent).toContain("1 in progress");
  expect(view.host.textContent).toContain("1 struggling");
  view.close();
});
it("uses the same totals and evidence states as Today, excluding conflicting lecture links", async () => {
 const { blockProgressCounts } = await import("../../logic/blockProgress.js");
 const lectures = [{ id: "l13", blockId: "NB", lectureNumber: 13, lectureType: "LEC" }];
 const objectives = [{ id: "old", code: "SAME", objective: "Nerve", linkedLecId: "l13", status: "struggling" }, { id: "new", code: "SAME", objective: "Nerve", linkedLecId: "l13" }, { id: "conflict", objective: "Wrong lecture", linkedLecId: "l13", lectureNumber: 17 }, { id: "unseen", objective: "New pathway", linkedLecId: "l13" }];
 const evidence = { objectives: { new: { attempts: 1, correct: 1, recent: [true] } } };
 const counts = blockProgressCounts({ blockId: "NB", lectures, objectives: { NB: objectives }, evidence });
 const view = mount(<ObjectiveTracker blockId="NB" blockLectures={lectures} objectives={objectives} learnerEvidence={evidence} onSelfRate={vi.fn()} onStartObjectiveQuiz={vi.fn()} />);
 expect(counts).toMatchObject({ total: 2, inprogress: 1, untested: 1, unlinked: 1 });
 expect(view.host.textContent).toContain(`Active objectives${counts.total}`);
 expect(view.host.textContent).toContain(`Developing${counts.inprogress}`);
 expect(view.host.textContent).toContain(`No answer evidence${counts.untested}`);
 expect(view.host.textContent).toContain("1 of 2 linked objectives seen");
 expect(view.host.textContent).toContain("Reference sources");
 view.close();
});
