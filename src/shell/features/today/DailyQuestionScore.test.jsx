import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const readBlockMock = vi.fn(() => []);
const listExamSessionsMock = vi.fn(async () => []);
vi.mock("../../../stores/calibrationByBlock.js", () => ({
  readBlock: (...args) => readBlockMock(...args),
  subscribe: () => () => {},
}));
vi.mock("../../../supabase.js", () => ({ listExamSessions: (...args) => listExamSessionsMock(...args) }));

const { DailyQuestionScore } = await import("./DailyQuestionScore.jsx");

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<DailyQuestionScore userId="u1" blockId="b1" />));
  return { host, unmount: () => act(() => root.unmount()) };
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("DailyQuestionScore", () => {
  beforeEach(() => {
    installDomStorage();
    readBlockMock.mockReset();
    readBlockMock.mockReturnValue([]);
    listExamSessionsMock.mockReset();
    listExamSessionsMock.mockResolvedValue([]);
  });

  it("shows the graded daily average against the 80% success target", async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    readBlockMock.mockReturnValue([{ ts: today, concept: "One", correct: true }]);
    listExamSessionsMock.mockResolvedValue([{
      sessionId: "today-exam", status: "submitted", submittedAt: today,
      questions: [
        { questionId: "q1", choices: { A: "yes", B: "no" }, correct: "A" },
        { questionId: "q2", choices: { A: "yes", B: "no" }, correct: "A" },
      ],
      answers: [{ questionId: "q1", value: "A" }, { questionId: "q2", value: "B" }],
    }]);

    const { host, unmount } = mount();
    await flush();
    expect(host.textContent).toContain("3 graded questions · 2 correct · 67% average");
    expect(host.textContent).toContain("Daily target · 80%");
    expect(host.textContent).toContain("13 percentage points");
    unmount();
  });

  it("celebrates reaching the 80% target", async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    readBlockMock.mockReturnValue([{ ts: today, concept: "One", correct: true }]);

    const { host, unmount } = mount();
    await flush();
    expect(host.textContent).toContain("100% average");
    expect(host.textContent).toContain("80% goal reached");
    unmount();
  });
});
