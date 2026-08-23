import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Smoke-level container test, per the brief: mock every child component and
// data source so this file only exercises ExamContainer's own view-state
// wiring (launch modal -> active session -> dashboard), not any earlier
// task's internals — those already have their own test files.
const launchExamSessionMock = vi.fn();
vi.mock("./launchExam.js", () => ({
  launchExamSession: (...args) => launchExamSessionMock(...args),
}));

const readTutorModeEnabledMock = vi.fn(() => false);
const writeTutorModeEnabledMock = vi.fn();
vi.mock("./tutorPrefs.js", () => ({
  readTutorModeEnabled: (...args) => readTutorModeEnabledMock(...args),
  writeTutorModeEnabled: (...args) => writeTutorModeEnabledMock(...args),
}));

vi.mock("../../hooks/useLectures.js", () => ({
  useLectures: () => ({
    data: [
      { id: "lec-1", blockId: "b1", lectureTitle: "Lecture One" },
      { id: "lec-2", blockId: "b1", lectureTitle: "Lecture Two" },
    ],
    mutate: vi.fn(),
  }),
}));

vi.mock("../../hooks/useObjectives.js", () => ({
  useObjectives: () => ({
    data: { b1: [{ id: "o1", objective: "Explain X", linkedLecId: "lec-1" }] },
    mutate: vi.fn(),
  }),
}));

vi.mock("../../../stores/lectureQuestionStats.js", () => ({
  statsForLecture: () => ({ answered: 0, correct: 0, accuracy: null }),
}));

vi.mock("../../../stores/weakConcepts.js", () => ({
  read: () => ({}),
  subscribe: () => () => {},
  isHydrated: () => true,
}));

vi.mock("../../../stores/questionBanks.js", () => ({
  read: () => ({}),
  subscribe: () => () => {},
  isHydrated: () => true,
}));

vi.mock("../../../stores/questionBankMeta.js", () => ({
  newestForBlock: () => null,
  subscribe: () => () => {},
  isHydrated: () => true,
}));

vi.mock("./ExamLaunchModal.jsx", () => ({
  ExamLaunchModal: ({ onLaunch, onCancel, launching }) => (
    <div data-testid="launch-modal" data-launching={launching ? "true" : "false"}>
      <button
        data-testid="fire-launch"
        disabled={launching}
        onClick={() => onLaunch({ format: "practice", questionCount: 10, durationMinutes: null })}
      >
        launch
      </button>
      <button data-testid="cancel-launch" onClick={onCancel}>cancel</button>
    </div>
  ),
}));

vi.mock("./ExamSessionRunner.jsx", () => ({
  ExamSessionRunner: ({ sessionId, onExit, tutorModeEnabled }) => (
    <div data-testid="session-runner" data-tutor-mode={tutorModeEnabled ? "true" : "false"}>
      runner for {sessionId}
      <button data-testid="exit-session" onClick={onExit}>exit</button>
    </div>
  ),
}));

vi.mock("./ExamDashboard.jsx", () => ({
  ExamDashboard: () => <div data-testid="exam-dashboard">dashboard</div>,
}));

const { ExamContainer } = await import("./ExamContainer.jsx");

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

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  installDomStorage();
  launchExamSessionMock.mockReset();
  readTutorModeEnabledMock.mockReset();
  readTutorModeEnabledMock.mockReturnValue(false);
  writeTutorModeEnabledMock.mockReset();
});

describe("ExamContainer", () => {
  it("renders the launch button and the dashboard when there is no active session", () => {
    const { host, unmount } = render(
      <ExamContainer blockId="b1" userId="u1" onNavigateToLecture={vi.fn()} />
    );

    expect(host.textContent).toMatch(/Integrated Exam/);
    expect(host.textContent).toMatch(/Start Integrated Exam/);
    expect(host.querySelector('[data-testid="exam-dashboard"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="session-runner"]')).toBeFalsy();

    unmount();
  });

  it("opening the modal and launching transitions to the session runner with the returned sessionId", async () => {
    launchExamSessionMock.mockResolvedValue({ ok: true, sessionId: "sess-123" });

    const { host, unmount } = render(
      <ExamContainer blockId="b1" userId="u1" onNavigateToLecture={vi.fn()} />
    );

    const startButton = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Start Integrated Exam")
    );
    act(() => startButton.click());
    expect(host.querySelector('[data-testid="launch-modal"]')).toBeTruthy();

    const fireLaunch = host.querySelector('[data-testid="fire-launch"]');
    await act(async () => {
      fireLaunch.click();
    });
    await flush();

    expect(launchExamSessionMock).toHaveBeenCalledTimes(1);
    const callArg = launchExamSessionMock.mock.calls[0][0];
    expect(callArg.userId).toBe("u1");
    expect(callArg.blockId).toBe("b1");
    expect(callArg.format).toBe("practice");
    expect(callArg.eligibleLectures).toEqual([
      { lectureId: "lec-1", lectureLabel: "Lecture One", objectiveCount: 1 },
    ]);

    expect(host.querySelector('[data-testid="launch-modal"]')).toBeFalsy();
    const runner = host.querySelector('[data-testid="session-runner"]');
    expect(runner).toBeTruthy();
    expect(runner.textContent).toMatch(/sess-123/);

    unmount();
  });

  it("shows the launch error inline and stays on the modal when launchExamSession fails", async () => {
    launchExamSessionMock.mockResolvedValue({ ok: false, error: "Could not generate any questions." });

    const { host, unmount } = render(
      <ExamContainer blockId="b1" userId="u1" onNavigateToLecture={vi.fn()} />
    );

    const startButton = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Start Integrated Exam")
    );
    act(() => startButton.click());

    const fireLaunch = host.querySelector('[data-testid="fire-launch"]');
    await act(async () => {
      fireLaunch.click();
    });
    await flush();

    expect(host.querySelector('[data-testid="launch-modal"]')).toBeTruthy();
    expect(host.textContent).toMatch(/Could not generate any questions\./);

    unmount();
  });

  it("onExit from the session runner returns to the dashboard view", async () => {
    launchExamSessionMock.mockResolvedValue({ ok: true, sessionId: "sess-456" });

    const { host, unmount } = render(
      <ExamContainer blockId="b1" userId="u1" onNavigateToLecture={vi.fn()} />
    );

    const startButton = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Start Integrated Exam")
    );
    act(() => startButton.click());
    await act(async () => {
      host.querySelector('[data-testid="fire-launch"]').click();
    });
    await flush();

    expect(host.querySelector('[data-testid="session-runner"]')).toBeTruthy();

    act(() => host.querySelector('[data-testid="exit-session"]').click());

    expect(host.querySelector('[data-testid="session-runner"]')).toBeFalsy();
    expect(host.querySelector('[data-testid="exam-dashboard"]')).toBeTruthy();

    unmount();
  });

  describe("review fixes", () => {
    it("fix #1: tutor-mode checkbox reads the stored preference, toggling writes it back and feeds the session runner", async () => {
      readTutorModeEnabledMock.mockReturnValue(true);

      const { host, unmount } = render(
        <ExamContainer blockId="b1" userId="u1" onNavigateToLecture={vi.fn()} />
      );

      const checkbox = host.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeTruthy();
      expect(checkbox.checked).toBe(true);

      act(() => {
        checkbox.dispatchEvent(new Event("click", { bubbles: true }));
        const propsKey = Object.keys(checkbox).find((k) => k.startsWith("__reactProps$"));
        checkbox[propsKey].onChange({ target: { checked: false } });
      });

      expect(writeTutorModeEnabledMock).toHaveBeenCalledWith(false);
      expect(checkbox.checked).toBe(false);

      // Launch a session and confirm the (now off) preference is what
      // actually reaches ExamSessionRunner's tutorModeEnabled prop.
      launchExamSessionMock.mockResolvedValue({ ok: true, sessionId: "sess-tutor" });
      const startButton = Array.from(host.querySelectorAll("button")).find((b) =>
        b.textContent.includes("Start Integrated Exam")
      );
      act(() => startButton.click());
      await act(async () => {
        host.querySelector('[data-testid="fire-launch"]').click();
      });
      await flush();

      const runner = host.querySelector('[data-testid="session-runner"]');
      expect(runner.dataset.tutorMode).toBe("false");

      unmount();
    });

    it("fix #2: a second launch call while one is already in flight is ignored (no double-launch)", async () => {
      let resolveLaunch;
      launchExamSessionMock.mockReturnValue(
        new Promise((resolve) => {
          resolveLaunch = resolve;
        })
      );

      const { host, unmount } = render(
        <ExamContainer blockId="b1" userId="u1" onNavigateToLecture={vi.fn()} />
      );

      const startButton = Array.from(host.querySelectorAll("button")).find((b) =>
        b.textContent.includes("Start Integrated Exam")
      );
      act(() => startButton.click());

      const fireLaunch = host.querySelector('[data-testid="fire-launch"]');
      act(() => fireLaunch.click());
      // Modal should now report launching=true (its own button also
      // disables, but the container itself is the actual race-closer).
      expect(host.querySelector('[data-testid="launch-modal"]').dataset.launching).toBe("true");

      // Fire a second launch while the first is still in flight.
      act(() => fireLaunch.click());
      act(() => fireLaunch.click());

      resolveLaunch({ ok: true, sessionId: "sess-once" });
      await flush();

      expect(launchExamSessionMock).toHaveBeenCalledTimes(1);
      expect(host.querySelector('[data-testid="session-runner"]').textContent).toMatch(/sess-once/);

      unmount();
    });

    it("fix #3: a thrown error from launchExamSession is caught, shows an error, and clears the launching state", async () => {
      launchExamSessionMock.mockRejectedValue(new Error("network blip"));

      const { host, unmount } = render(
        <ExamContainer blockId="b1" userId="u1" onNavigateToLecture={vi.fn()} />
      );

      const startButton = Array.from(host.querySelectorAll("button")).find((b) =>
        b.textContent.includes("Start Integrated Exam")
      );
      act(() => startButton.click());

      await act(async () => {
        host.querySelector('[data-testid="fire-launch"]').click();
      });
      await flush();

      expect(host.textContent).toMatch(/network blip/);
      // Not stuck: the modal is still there (didn't crash/unmount) and no
      // longer reports launching, so a retry is possible.
      const modal = host.querySelector('[data-testid="launch-modal"]');
      expect(modal).toBeTruthy();
      expect(modal.dataset.launching).toBe("false");
      expect(host.querySelector('[data-testid="fire-launch"]').disabled).toBe(false);

      unmount();
    });
  });
});
