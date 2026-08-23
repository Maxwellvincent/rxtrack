import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Smoke-level coverage only, per the brief — the controller hook's own test
// file carries the real weight. Mock the hook entirely so this file is a
// pure render test over the two format branches.
const controllerMock = vi.fn();
vi.mock("./useExamSessionController.js", () => ({
  useExamSessionController: (...args) => controllerMock(...args),
}));

const { ExamSessionRunner } = await import("./ExamSessionRunner.jsx");

function makeQuestion(questionId, letter = "A") {
  return {
    questionId,
    blockId: "b1",
    lectureId: "lec-1",
    objectiveIds: [],
    stem: `Stem for ${questionId}`,
    choices: { A: "Choice A", B: "Choice B" },
    correct: letter,
    explanation: "Because reasons.",
  };
}

function baseController(overrides = {}) {
  return {
    session: {
      sessionId: "s1",
      blockId: "b1",
      format: "exam",
      status: "in_progress",
      questions: [makeQuestion("q1"), makeQuestion("q2")],
      answers: [],
      deadline: Date.now() + 60_000,
    },
    loading: false,
    error: null,
    currentIndex: 0,
    setCurrentIndex: vi.fn(),
    remainingMs: 45_000,
    syncStatus: "synced",
    submitting: false,
    submitResult: null,
    answerQuestion: vi.fn(() => true),
    submit: vi.fn(async () => ({ ok: true })),
    abandon: vi.fn(async () => ({ status: "abandoned" })),
    refetch: vi.fn(),
    ...overrides,
  };
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

beforeEach(() => {
  installDomStorage();
  controllerMock.mockReset();
});

describe("ExamSessionRunner", () => {
  it("format exam: renders a countdown timer, a submit button, and no per-question reveal", () => {
    controllerMock.mockReturnValue(baseController());

    const { host, unmount } = render(<ExamSessionRunner sessionId="s1" userId="u1" />);

    expect(host.querySelector('[data-testid="exam-timer"]')).toBeTruthy();
    expect(host.textContent).toMatch(/Submit exam/);
    // No per-question reveal: correct/explanation text never renders pre-submit.
    expect(host.textContent).not.toMatch(/Because reasons\./);
    expect(host.querySelector('[data-testid="practice-reveal"]')).toBeFalsy();

    unmount();
  });

  it("format practice: renders one question and reveals + explains after answering", () => {
    const controller = baseController({
      session: {
        sessionId: "s1",
        blockId: "b1",
        format: "practice",
        status: "in_progress",
        questions: [makeQuestion("q1", "A")],
        answers: [],
        deadline: null,
      },
      remainingMs: null,
    });
    controllerMock.mockReturnValue(controller);

    const { host, rerender, unmount } = render(<ExamSessionRunner sessionId="s1" userId="u1" />);

    // Not revealed yet: no timer, no reveal marker.
    expect(host.querySelector('[data-testid="exam-timer"]')).toBeFalsy();
    expect(host.querySelector('[data-testid="practice-reveal"]')).toBeFalsy();

    // Answering flows through answerQuestion; simulate the resulting
    // controller state (answered) on a re-render, the way the real hook
    // would after answerQuestion's optimistic update.
    const answeredController = {
      ...controller,
      session: {
        ...controller.session,
        answers: [{ questionId: "q1", value: "A", answeredAt: Date.now(), seq: 0, writerId: "w1" }],
      },
    };
    controllerMock.mockReturnValue(answeredController);
    rerender(<ExamSessionRunner sessionId="s1" userId="u1" />);

    expect(host.querySelector('[data-testid="practice-reveal"]')).toBeTruthy();
    expect(host.textContent).toMatch(/Because reasons\./);

    unmount();
  });

  it("shows a distinct 'finishing up' state and calls submit() when resuming a 'finalizing' session", async () => {
    const submit = vi.fn(async () => ({ ok: true }));
    controllerMock.mockReturnValue(
      baseController({
        session: { ...baseController().session, status: "finalizing" },
        submit,
      })
    );

    const { host, unmount } = render(<ExamSessionRunner sessionId="s1" userId="u1" />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toMatch(/Finishing up/);
    expect(submit).toHaveBeenCalledTimes(1);

    unmount();
  });
});
