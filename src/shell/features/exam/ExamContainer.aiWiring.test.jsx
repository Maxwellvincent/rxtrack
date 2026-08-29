import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Final-review fix C1 — the earlier ExamContainer.test.jsx mocks
// `launchExam.js` wholesale, which is exactly why "no caller ever supplies
// callAIJSON" was invisible: every task's own tests inject the transport
// themselves at whatever seam they choose to mock, and no test exercised the
// real wiring between ExamContainer and the AI transport.
//
// This file mocks only the true edges: the AI transport itself
// (`aiClient.js`'s `callAIJSON`) and the Firestore write (`supabase.js`'s
// `createExamSession`) — everything in between (`launchExam.js`,
// `generation.js`, `allocation.js`, `quizLaunch.js`, `engine/mcq.js`) is the
// REAL module. If ExamContainer ever again forgets to pass `{ callAIJSON }`
// into `launchExamSession`, `callAIJSON` will never be called and this test
// fails — unlike ExamContainer.test.jsx's fully-mocked `launchExamSession`,
// which can't detect that failure mode at all.
const callAIJSONMock = vi.fn();
vi.mock("../../../aiClient.js", () => ({
  callAIJSON: (...args) => callAIJSONMock(...args),
  callAI: vi.fn(),
}));

const createExamSessionMock = vi.fn();
vi.mock("../../../supabase.js", () => ({
  createExamSession: (...args) => createExamSessionMock(...args),
  checkExamAccess: async () => {},
  listExamSessions: async () => [],
}));
vi.mock("../../../questionPool.js", async importOriginal => ({
  ...await importOriginal(),
  questionPoolKey: async () => "test-bucket",
  createQuestionPool: userId => ({ begin: async () => {}, finish: async () => {},
    summary: async () => ({ ready: 0, assigned: 0, total: 0 }),
    history: async () => [], ready: async () => [], save: async q => ({ ...q, poolId: q.questionId }),
    commit: session => createExamSessionMock(userId, session),
  }),
}));

vi.mock("./tutorPrefs.js", () => ({
  readTutorModeEnabled: () => false,
  writeTutorModeEnabled: vi.fn(),
}));

const LECTURE = {
  id: "lec-1",
  blockId: "b1",
  lectureTitle: "Real Wiring Lecture",
  // >=150 chars so generateMcqs's lecture-text floor is met and it actually
  // calls callAIJSON instead of short-circuiting on "not enough text".
  extractedText: "A".repeat(200),
};

vi.mock("../../hooks/useLectures.js", () => ({
  useLectures: () => ({ data: [LECTURE], mutate: vi.fn() }),
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
  read: () => ({}),
  newestForBlock: () => null,
  subscribe: () => () => {},
  isHydrated: () => true,
}));

// Settable per-test so the I4 test below can request a count the mocked
// transport can't fully satisfy, producing a real (not fabricated)
// generationErrors shortfall from generation.js's own retry logic.
let testQuestionCount = 1;

vi.mock("./ExamLaunchModal.jsx", () => ({
  ExamLaunchModal: ({ onLaunch, launching }) => (
    <div data-testid="launch-modal">
      <button
        data-testid="fire-launch"
        disabled={launching}
        onClick={() => onLaunch({ format: "practice", questionCount: testQuestionCount, durationMinutes: null })}
      >
        launch
      </button>
    </div>
  ),
}));

vi.mock("./ExamSessionRunner.jsx", () => ({
  ExamSessionRunner: ({ sessionId }) => <div data-testid="session-runner">runner for {sessionId}</div>,
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
    unmount: () => act(() => root.unmount()),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  installDomStorage();
  testQuestionCount = 1;
  callAIJSONMock.mockReset();
  createExamSessionMock.mockReset();
  createExamSessionMock.mockResolvedValue({ ok: true });
  callAIJSONMock.mockResolvedValue({
    questions: [
      {
        stem: "A real generated stem",
        choices: { A: "a", B: "b" },
        correct: "A",
        explanation: "because",
      },
    ],
  });
});

describe("ExamContainer -> real AI transport wiring (final-review fix C1)", () => {
  it("a real launch reaches all the way down to aiClient.js's callAIJSON — not a fully-mocked launchExamSession", async () => {
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

    // The real proof: the AI transport genuinely got called. Before the C1
    // fix, ExamContainer called launchExamSession(config) with no second
    // argument, deps defaulted to {} the whole way down, and
    // generateMcqs's `deps.callAIJSON` was undefined — this call would never
    // happen and every launch would fail with "Could not generate any
    // questions."
    expect(callAIJSONMock).toHaveBeenCalledTimes(1);
    expect(createExamSessionMock).toHaveBeenCalledTimes(1);

    // And the launch actually succeeded end-to-end (transitioned to the
    // session runner), proving this isn't just an incidental call.
    expect(host.querySelector('[data-testid="session-runner"]')).toBeTruthy();

    unmount();
  });

  it("final-review fix I4: a non-empty generationErrors from a real (partial-success) launch is surfaced, not silently dropped", async () => {
    // Ask for 2 questions but let the real (mocked-only-at-callAIJSON)
    // pipeline produce just 1 per attempt, across all 3 retry attempts —
    // generation.js's own retry/shortfall logic (unit-tested separately)
    // genuinely reports `{lectureId, requested: 2, obtained: 1, message}`
    // here; this test is only about ExamContainer actually reading and
    // displaying it instead of dropping it on the floor.
    testQuestionCount = 2;
    // Attempt 1 yields 1 survivor; attempts 2-3 (the retries) yield nothing
    // further, so generation.js's own retry loop genuinely exhausts at 1 of
    // 2 requested instead of accumulating to a false non-shortfall.
    callAIJSONMock
      .mockResolvedValueOnce({
        questions: [{ stem: "Only one", choices: { A: "a", B: "b" }, correct: "A", explanation: "" }],
      })
      .mockResolvedValue({ questions: [] });

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
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
    expect(host.textContent).toMatch(/1\/2 questions ready/);

    unmount();
  });

  it("final-review fix I4 baseline: a fully-satisfied launch (no shortfall) shows no warning", async () => {
    testQuestionCount = 1;

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
    expect(host.querySelector('[role="alert"]')).toBeFalsy();

    unmount();
  });
});
