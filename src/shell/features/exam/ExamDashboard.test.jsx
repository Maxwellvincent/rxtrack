import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listExamSessionsMock = vi.fn();
const readWeakConceptsMock = vi.fn();

vi.mock("../../../supabase.js", () => ({
  listExamSessions: (...args) => listExamSessionsMock(...args),
}));

vi.mock("../../../stores/weakConcepts.js", () => ({
  read: (...args) => readWeakConceptsMock(...args),
}));

const { ExamDashboard } = await import("./ExamDashboard.jsx");

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

const USER = "u1";
const BLOCK = "b1";
const LECTURES = {
  "lec-1": { lectureTitle: "Lecture One" },
  "lec-2": { lectureTitle: "Lecture Two" },
};

function makeSession({ id, blockId = BLOCK, questions, answers }) {
  return {
    id,
    blockId,
    status: "submitted",
    questions,
    answers,
  };
}

function q(questionId, lectureId, correct = "A") {
  return { questionId, lectureId, correct };
}

function a(questionId, value) {
  return { questionId, value };
}

beforeEach(() => {
  installDomStorage();
  listExamSessionsMock.mockReset();
  readWeakConceptsMock.mockReset();
  readWeakConceptsMock.mockReturnValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ExamDashboard", () => {
  it("shows loading state before the fetch resolves, not an empty state", async () => {
    let resolveFetch;
    listExamSessionsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    const { host, unmount } = render(
      <ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} onNavigateToLecture={vi.fn()} />
    );

    expect(host.textContent).toMatch(/Loading/);
    expect(host.textContent).not.toMatch(/No Integrated Exam attempts/);

    resolveFetch([]);
    await flush();
    unmount();
  });

  it("shows empty state when there are no submitted sessions for the block", async () => {
    listExamSessionsMock.mockResolvedValue([]);

    const { host, unmount } = render(
      <ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} onNavigateToLecture={vi.fn()} />
    );
    await flush();

    expect(host.textContent).toMatch(/No Integrated Exam attempts yet for this block/);
    unmount();
  });

  it("computes per-lecture accuracy by summing evaluateSessionForLecture across sessions (unanswered counts as miss)", async () => {
    const sessionA = makeSession({
      id: "s1",
      questions: [q("q1", "lec-1"), q("q2", "lec-1"), q("q3", "lec-1")],
      // q1 correct, q2 wrong, q3 unanswered (counts as miss)
      answers: [a("q1", "A"), a("q2", "B")],
    });
    const sessionB = makeSession({
      id: "s2",
      questions: [q("q4", "lec-1")],
      answers: [a("q4", "A")],
    });
    listExamSessionsMock.mockResolvedValue([sessionA, sessionB]);

    const { host, unmount } = render(
      <ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} onNavigateToLecture={vi.fn()} />
    );
    await flush();

    // 4 total questions, 2 misses (q2 wrong, q3 unanswered) -> 50% accuracy
    expect(host.textContent).toMatch(/Lecture One/);
    expect(host.textContent).toMatch(/4 questions/);
    expect(host.textContent).toMatch(/50%/);
    unmount();
  });

  it("shows the weak-lecture link only for a lecture with a struggling weak-concept entry, not by a raw accuracy threshold", async () => {
    const strugglingSession = makeSession({
      id: "s1",
      questions: [q("q1", "lec-1")],
      answers: [a("q1", "B")], // wrong -> 0% accuracy, lec-1
    });
    const lowAccuracyButNotFlaggedSession = makeSession({
      id: "s2",
      questions: [q("q2", "lec-2")],
      answers: [a("q2", "B")], // also wrong -> 0% accuracy, lec-2, but NOT in weakConcepts
    });
    listExamSessionsMock.mockResolvedValue([strugglingSession, lowAccuracyButNotFlaggedSession]);
    readWeakConceptsMock.mockReturnValue({
      [BLOCK]: [
        {
          id: `exam:${BLOCK}:lec-1`,
          masteryLevel: "struggling",
          linkedLecIds: ["lec-1"],
        },
      ],
    });

    const { host, unmount } = render(
      <ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} onNavigateToLecture={vi.fn()} />
    );
    await flush();

    const lecOneRow = Array.from(host.querySelectorAll("div")).find(
      (el) => el.textContent.startsWith("Lecture One")
    );
    const lecTwoRow = Array.from(host.querySelectorAll("div")).find(
      (el) => el.textContent.startsWith("Lecture Two")
    );
    expect(lecOneRow.querySelector("button")).toBeTruthy();
    expect(lecTwoRow.querySelector("button")).toBeFalsy();
    unmount();
  });

  it("calls onNavigateToLecture with the lectureId when the weak-lecture link is clicked", async () => {
    const session = makeSession({
      id: "s1",
      questions: [q("q1", "lec-1")],
      answers: [a("q1", "B")],
    });
    listExamSessionsMock.mockResolvedValue([session]);
    readWeakConceptsMock.mockReturnValue({
      [BLOCK]: [{ id: `exam:${BLOCK}:lec-1`, masteryLevel: "struggling", linkedLecIds: ["lec-1"] }],
    });

    const onNavigateToLecture = vi.fn();
    const { host, unmount } = render(
      <ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} onNavigateToLecture={onNavigateToLecture} />
    );
    await flush();

    const button = host.querySelector("button");
    act(() => button.click());

    expect(onNavigateToLecture).toHaveBeenCalledWith("lec-1");
    unmount();
  });

  it("scopes the listExamSessions call by blockId and excludes mixed-block weak-concept entries", async () => {
    listExamSessionsMock.mockResolvedValue([]);
    readWeakConceptsMock.mockReturnValue({
      [BLOCK]: [],
      "other-block": [{ id: "exam:other-block:lec-9", masteryLevel: "struggling", linkedLecIds: ["lec-9"] }],
    });

    const { unmount } = render(
      <ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} onNavigateToLecture={vi.fn()} />
    );
    await flush();

    expect(listExamSessionsMock).toHaveBeenCalledWith(USER, BLOCK, { status: "submitted" });
    unmount();
  });
});
