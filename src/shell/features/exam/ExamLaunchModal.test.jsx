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

describe("ExamLaunchModal", () => {
  it("renders format, question count, and duration controls (duration shown by default: exam format)", () => {
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={20}
        onLaunch={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(host.textContent).toMatch(/Exam conditions/);
    expect(host.textContent).toMatch(/Practice/);
    expect(host.querySelector('input[type="number"]')).toBeTruthy();
    expect(host.textContent).toMatch(/Duration/);

    unmount();
  });

  it("duration control is hidden when format is practice", () => {
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={20}
        onLaunch={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const practiceBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Practice");
    act(() => practiceBtn.click());

    expect(host.textContent).not.toMatch(/Duration/);

    unmount();
  });

  it("launch button is disabled when eligibleLectures is empty, and shows the no-material message", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={[]}
        defaultQuestionCount={20}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />
    );

    expect(host.textContent).toMatch(/No lectures in this block have objectives yet/);
    const startBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Start exam");
    expect(startBtn.disabled).toBe(true);

    act(() => startBtn.click());
    expect(onLaunch).not.toHaveBeenCalled();

    unmount();
  });

  it("onLaunch is called with the right shape on confirm (practice format: durationMinutes null)", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={15}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />
    );

    const practiceBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Practice");
    act(() => practiceBtn.click());

    const startBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Start exam");
    act(() => startBtn.click());

    expect(onLaunch).toHaveBeenCalledWith({ format: "practice", questionCount: 15, durationMinutes: null });

    unmount();
  });

  it("duration defaults to 1.5 min/question and launch is enabled without typing", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={20}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />
    );

    const durationInput = host.querySelectorAll('input[type="number"]')[1];
    expect(durationInput.value).toBe("30"); // 20 * 1.5

    const startBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Start exam");
    expect(startBtn.disabled).toBe(false);
    act(() => startBtn.click());
    expect(onLaunch).toHaveBeenCalledWith({ format: "exam", questionCount: 20, durationMinutes: 30 });

    unmount();
  });

  it("duration auto-recalculates as question count changes, until the user edits it directly", () => {
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={20}
        onLaunch={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const countInput = host.querySelector('input[type="number"]');
    const durationInput = host.querySelectorAll('input[type="number"]')[1];
    expect(durationInput.value).toBe("30");

    act(() => setInputValue(countInput, "10"));
    expect(durationInput.value).toBe("15"); // still auto-following: 10 * 1.5

    // User types a duration directly — auto-calc stops following count.
    act(() => setInputValue(durationInput, "60"));
    act(() => setInputValue(countInput, "40"));
    expect(durationInput.value).toBe("60"); // unchanged, no longer auto-calculated

    unmount();
  });

  it("keeps an exact 90-second budget for odd question counts", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={15}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />
    );
    const durationInput = host.querySelectorAll('input[type="number"]')[1];
    expect(durationInput.value).toBe("22.5");
    const start = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Start exam");
    act(() => start.click());
    expect(onLaunch).toHaveBeenCalledWith({ format: "exam", questionCount: 15, durationMinutes: 22.5 });
    unmount();
  });

  it("defaults a generated 100-question exam to 150 minutes", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={100}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />
    );
    const inputs = host.querySelectorAll('input[type="number"]');
    expect(inputs[0].value).toBe("100");
    expect(inputs[1].value).toBe("150");
    const start = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Start exam");
    act(() => start.click());
    expect(onLaunch).toHaveBeenCalledWith({ format: "exam", questionCount: 100, durationMinutes: 150 });
    unmount();
  });

  it("clearing a typed duration back to empty blocks launch (still exam format, still required)", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={15}
        onLaunch={onLaunch}
        onCancel={vi.fn()}
      />
    );

    const durationInput = host.querySelectorAll('input[type="number"]')[1];
    act(() => setInputValue(durationInput, ""));

    const startBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Start exam");
    expect(startBtn.disabled).toBe(true);
    act(() => startBtn.click());
    expect(onLaunch).not.toHaveBeenCalled();

    act(() => setInputValue(durationInput, "60"));
    expect(startBtn.disabled).toBe(false);
    act(() => startBtn.click());
    expect(onLaunch).toHaveBeenCalledWith({ format: "exam", questionCount: 15, durationMinutes: 60 });

    unmount();
  });

  it("question count input is capped at 100", () => {
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={20}
        onLaunch={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const countInput = host.querySelectorAll('input[type="number"]')[0];
    act(() => setInputValue(countInput, "999"));

    expect(countInput.value).toBe("100");

    unmount();
  });

  it("can scope an exam to one week of lecture content", () => {
    const onLaunch = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        eligibleLectures={[
          { lectureId: "l1", objectiveCount: 5, weekNumber: 1 },
          { lectureId: "l2", objectiveCount: 7, weekNumber: 2 },
        ]}
        defaultQuestionCount={10}
        onLaunch={onLaunch}
      />
    );
    const scope = host.querySelector("select");
    act(() => setInputValue(scope, "2"));
    expect(host.textContent).toContain("7 objectives across 1 lectures");
    const start = [...host.querySelectorAll("button")].find(button => button.textContent === "Start exam");
    act(() => start.click());
    expect(onLaunch).toHaveBeenCalledWith({ format: "exam", questionCount: 10, durationMinutes: 15, weekNumber: "2" });
    unmount();
  });

  it("launching=true disables both buttons and relabels Start (Task 12 review fix #2, double-launch race)", () => {
    const onLaunch = vi.fn();
    const onCancel = vi.fn();
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        defaultQuestionCount={15}
        onLaunch={onLaunch}
        onCancel={onCancel}
        launching
      />
    );

    const startBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent.includes("Starting"));
    const cancelBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "Cancel");
    expect(startBtn).toBeTruthy();
    expect(startBtn.disabled).toBe(true);
    expect(cancelBtn.disabled).toBe(true);

    act(() => startBtn.click());
    act(() => cancelBtn.click());
    expect(onLaunch).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    unmount();
  });

  it("falls back to 20 when defaultQuestionCount is not provided", () => {
    const { host, unmount } = render(
      <ExamLaunchModal
        blockId="b1"
        userId="u1"
        eligibleLectures={ELIGIBLE}
        onLaunch={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const countInput = host.querySelectorAll('input[type="number"]')[0];
    expect(countInput.value).toBe("20");

    unmount();
  });
});
