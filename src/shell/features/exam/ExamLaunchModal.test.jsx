import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { ExamLaunchModal } from "./ExamLaunchModal.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// This repo has no @testing-library/react and React 19 dropped
// react-dom/test-utils' `Simulate` helper, so there's no ready-made way to
// fire a real DOM "input" event and have React's ChangeEventPlugin pick it
// up reliably under jsdom-via-node (its value-tracker dance depends on
// feature detection cached before installDomStorage() sets up `window`).
// Grab the fiber's committed props directly (React stashes them on the DOM
// node under a `__reactProps$...` key) and invoke onChange the way React's
// own event system would, with the same event-shaped argument.
function setInputValue(input, value) {
  const propsKey = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
  input[propsKey].onChange({ target: { value } });
}

function render(ui) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return {
    host,
    rerender: (nextUi) => act(() => root.render(nextUi)),
    unmount: () => act(() => root.unmount()),
  };
}

const ELIGIBLE = [
  { lectureId: "lec-1", lectureLabel: "Lecture 1", objectiveCount: 5 },
  { lectureId: "lec-2", lectureLabel: "Lecture 2", objectiveCount: 3 },
];

beforeEach(() => installDomStorage());

const buttons = (host) => Array.from(host.querySelectorAll("button"));
const byText = (host, text) => buttons(host).find((b) => b.textContent === text);
const byIncl = (host, text) => buttons(host).find((b) => b.textContent.includes(text));
const startButton = (host) => byText(host, "Start");
const durationInput = (host) => host.querySelector('[aria-label="Duration (minutes)"]');
const countInput = (host) => host.querySelector('[aria-label="Number of questions"]');
const timed = (host) => act(() => byText(host, "Timed exam").click());

const WEEKS = [
  { lectureId: "l1", lectureLabel: "Lecture 1", objectiveCount: 5, weekNumber: 1, lectureDate: "2026-11-02" },
  { lectureId: "l2", lectureLabel: "Lecture 2", objectiveCount: 7, weekNumber: 2, lectureDate: "2026-11-09" },
  { lectureId: "l3", lectureLabel: "Lecture 3", objectiveCount: 4, weekNumber: 2, lectureDate: "2026-11-10" },
  { lectureId: "l4", lectureLabel: "Lecture 4", objectiveCount: 6, weekNumber: 3, lectureDate: "2026-11-16" },
];

describe("ExamLaunchModal", () => {
  it("offers an immediate start that will fill the remaining questions after a provider shortfall", () => {
    const onStartSaved = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal eligibleLectures={WEEKS} defaultQuestionCount={30}
        onLaunch={vi.fn()} onCancel={vi.fn()} error="28/30 ready" partialLaunch={{ readyCount: 28 }} onStartSaved={onStartSaved} />
    );
    act(() => byIncl(host, "Start with 28 saved questions").click());
    expect(onStartSaved).toHaveBeenCalledWith(expect.objectContaining({ questionCount: 28, assessmentFormat: "imcq", weekNumber: "3" }));
    unmount();
  });

  it("opens on IMCQ for the latest week, untimed, when lectures have weeks", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={WEEKS} defaultQuestionCount={20} onLaunch={onLaunch} onCancel={vi.fn()} />);
    expect(host.querySelector('[role="radio"][aria-checked="true"]').textContent).toContain("IMCQ");
    expect(host.querySelector('[aria-label="Week"]').value).toBe("3");
    expect(durationInput(host)).toBeNull();
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({
      format: "practice", assessmentFormat: "imcq", weekNumber: "3", questionCount: 20, durationMinutes: null, startWhilePreparing: true,
      examName: expect.stringMatching(/^Practice quiz · IMCQ · Week 3 ·/),
    }));
    unmount();
  });

  it("IMCQ can pick another week and says how many items join two lectures", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={WEEKS} defaultQuestionCount={10} onLaunch={onLaunch} onCancel={vi.fn()} />);
    act(() => setInputValue(host.querySelector('[aria-label="Week"]'), "2"));
    const summary = host.querySelector('[aria-label="Set summary"]').textContent;
    expect(summary).toContain("2 lectures · 11 objectives");
    expect(summary).toContain("about 40% of questions link two lectures");
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ assessmentFormat: "imcq", weekNumber: "2" }));
    unmount();
  });

  it("homework practices one lecture, newest first", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={WEEKS} defaultQuestionCount={10} onLaunch={onLaunch} onCancel={vi.fn()} />);
    act(() => byIncl(host, "Homework").click());
    const lecture = host.querySelector('[aria-label="Lecture"]');
    expect(lecture.value).toBe("lecture:l4");
    act(() => setInputValue(lecture, "lecture:l2"));
    expect(host.querySelector('[aria-label="Set summary"]').textContent).toContain("1 lecture · 7 objectives");
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ assessmentFormat: "homework", contentScope: "lecture:l2" }));
    unmount();
  });

  it("ESoft spans a range of weeks", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={WEEKS} defaultQuestionCount={10} onLaunch={onLaunch} onCancel={vi.fn()} />);
    act(() => byIncl(host, "ESoft").click());
    expect(host.querySelector('[aria-label="From week"]').value).toBe("2");
    expect(host.querySelector('[aria-label="Through week"]').value).toBe("3");
    act(() => setInputValue(host.querySelector('[aria-label="From week"]'), "1"));
    expect(host.querySelector('[aria-label="Set summary"]').textContent).toContain("4 lectures · 22 objectives");
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ assessmentFormat: "esoft", contentScope: "week-range:1:3" }));
    unmount();
  });

  it("can open preset to a format from the Exam tab", () => {
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={WEEKS} defaultKind="esoft" onLaunch={vi.fn()} onCancel={vi.fn()} />);
    expect(host.querySelector('[role="radio"][aria-checked="true"]').textContent).toContain("ESoft");
    unmount();
  });

  it("falls back to custom scope when lectures have no weeks", () => {
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} onLaunch={vi.fn()} onCancel={vi.fn()} />);
    expect(host.querySelector('[aria-label="Content scope"]').value).toBe("block-so-far");
    expect(host.textContent).toContain("Custom scope");
    unmount();
  });

  it("suggests a descriptive title and preserves a custom title", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} defaultQuestionCount={12} onLaunch={onLaunch} />);
    const name = host.querySelector("#exam-name");
    expect(name.value).toMatch(/^Practice quiz · Block so far · 12 questions ·/);
    act(() => setInputValue(name, "My custom exam"));
    timed(host);
    expect(name.value).toBe("My custom exam");
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ examName: "My custom exam", format: "exam" }));
    unmount();
  });

  it("launch button is disabled when there are no lectures", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={[]} defaultQuestionCount={20} onLaunch={onLaunch} onCancel={vi.fn()} />);
    expect(host.textContent).toMatch(/No lectures with objectives in this choice/);
    expect(startButton(host).disabled).toBe(true);
    act(() => startButton(host).click());
    expect(onLaunch).not.toHaveBeenCalled();
    unmount();
  });

  it("timed mode defaults to 72 seconds per question", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} defaultQuestionCount={20} onLaunch={onLaunch} onCancel={vi.fn()} />);
    timed(host);
    expect(durationInput(host).value).toBe("24");
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ format: "exam", examName: expect.stringMatching(/^Timed exam ·/), questionCount: 20, durationMinutes: 24 }));
    unmount();
  });

  it("duration follows question count until edited directly", () => {
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} defaultQuestionCount={20} onLaunch={vi.fn()} onCancel={vi.fn()} />);
    timed(host);
    act(() => setInputValue(countInput(host), "10"));
    expect(durationInput(host).value).toBe("12");
    act(() => byText(host, "40").click());
    expect(durationInput(host).value).toBe("48");
    act(() => setInputValue(durationInput(host), "60"));
    act(() => setInputValue(countInput(host), "15"));
    expect(durationInput(host).value).toBe("60");
    unmount();
  });

  it("an empty duration blocks a timed launch", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} defaultQuestionCount={15} onLaunch={onLaunch} onCancel={vi.fn()} />);
    timed(host);
    act(() => setInputValue(durationInput(host), ""));
    expect(startButton(host).disabled).toBe(true);
    act(() => setInputValue(durationInput(host), "60"));
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ durationMinutes: 60, questionCount: 15 }));
    unmount();
  });

  it("caps question count at 100 and defaults to 20", () => {
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} onLaunch={vi.fn()} onCancel={vi.fn()} />);
    expect(countInput(host).value).toBe("20");
    act(() => setInputValue(countInput(host), "999"));
    expect(countInput(host).value).toBe("100");
    unmount();
  });

  it("starts within the limit when a saved default exceeds 100", () => {
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} defaultQuestionCount={150} onLaunch={vi.fn()} onCancel={vi.fn()} />);
    expect(countInput(host).value).toBe("100");
    timed(host);
    expect(durationInput(host).value).toBe("120");
    unmount();
  });

  it("focused repair opens More options and keeps its targets on every action", () => {
    const onLaunch = vi.fn(), onPrepare = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={WEEKS} defaultQuestionCount={8}
      defaultStudyMode="repair" defaultTargetObjectiveIds={["o-priority"]} defaultFocusNotes="Prioritize pupillary reflexes"
      onPrepare={onPrepare} onLaunch={onLaunch} onCancel={vi.fn()} />);
    expect(host.querySelector("details").open).toBe(true);
    expect(host.querySelector("#exam-focus-notes").value).toContain("pupillary reflexes");
    act(() => byText(host, "Start focused repair").click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ studyMode: "repair", targetObjectiveIds: ["o-priority"], focusNotes: "Prioritize pupillary reflexes" }));
    act(() => byText(host, "Prepare for later").click());
    expect(onPrepare).toHaveBeenCalledWith(expect.objectContaining({ studyMode: "repair", targetObjectiveIds: ["o-priority"] }));
    unmount();
  });

  it("passes difficulty and assessment format to Prepare for later", () => {
    const onLaunch = vi.fn(), onPrepare = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={WEEKS} defaultQuestionCount={10} onLaunch={onLaunch} onPrepare={onPrepare} onCancel={vi.fn()} />);
    act(() => byText(host, "Medium").click());
    act(() => byText(host, "Prepare for later").click());
    expect(onPrepare).toHaveBeenCalledWith(expect.objectContaining({ difficultyOverride: "medium", questionCount: 10, assessmentFormat: "imcq", weekNumber: "3" }));
    expect(onPrepare.mock.calls[0][0].startWhilePreparing).toBeUndefined();
    unmount();
  });

  it("launches a concept drill against one exact lecture via custom scope", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={[
      { lectureId: "auditory", lectureLabel: "Auditory system", objectiveCount: 4 },
      { lectureId: "vision", lectureLabel: "Visual pathways", objectiveCount: 5 },
    ]} defaultQuestionCount={10} onLaunch={onLaunch} />);
    act(() => setInputValue(host.querySelector("#exam-focus-notes"), "Weber and Rinne; conductive vs sensorineural loss"));
    act(() => setInputValue(host.querySelector('[aria-label="Content scope"]'), "lecture:auditory"));
    expect(host.querySelector('[aria-label="Set summary"]').textContent).toContain("1 lecture · 4 objectives");
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ contentScope: "lecture:auditory", focusNotes: "Weber and Rinne; conductive vs sensorineural loss" }));
    expect(onLaunch.mock.calls[0][0].assessmentFormat).toBeUndefined();
    unmount();
  });

  it("launching=true disables Start and Cancel", () => {
    const onLaunch = vi.fn(), onCancel = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} onLaunch={onLaunch} onCancel={onCancel} launching />);
    const start = byIncl(host, "Opening");
    const cancel = byText(host, "Cancel");
    expect(start.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    act(() => start.click());
    act(() => cancel.click());
    expect(onLaunch).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    unmount();
  });

  it("keeps settings open when clicking the backdrop", () => {
    const onCancel = vi.fn();
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={ELIGIBLE} onLaunch={vi.fn()} onCancel={onCancel} />);
    act(() => setInputValue(countInput(host), "30"));
    act(() => host.querySelector('[role="dialog"]').click());
    expect(onCancel).not.toHaveBeenCalled();
    expect(countInput(host).value).toBe("30");
    act(() => host.querySelector('[aria-label="Close exam settings"]').click());
    expect(onCancel).toHaveBeenCalledOnce();
    unmount();
  });

  it("Full NB exam launches the blueprint across objective-linked lectures, timed", () => {
    const onLaunch = vi.fn();
    const candidates = [{ lectureId: "all", objectiveCount: 3 }];
    const { host, unmount } = render(<ExamLaunchModal eligibleLectures={[]} blueprintLectures={candidates}
      blueprintObjectives={{ all: [{ id: "a", discipline: "ANAT" }, { id: "n", discipline: "NSCI" }, { id: "h", discipline: "HCB" }] }}
      defaultBlueprintExam="3" defaultQuestionCount={40} onLaunch={onLaunch} onCancel={() => {}} />);
    expect(host.querySelector('[role="radio"][aria-checked="true"]').textContent).toContain("Full NB exam");
    expect(durationInput(host).value).toBe("48");
    act(() => startButton(host).click());
    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({ blueprintExam: 3, contentScope: "entire-block", questionCount: 40, format: "exam" }));
    unmount();
  });
});
