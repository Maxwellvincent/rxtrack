import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const listExamSessionsMock = vi.fn();
const deleteExamSessionMock = vi.fn();
const readWeakConceptsMock = vi.fn();
const readLearnerEvidenceMock = vi.fn();

vi.mock("../../../supabase.js", () => ({
  listExamSessions: (...args) => listExamSessionsMock(...args),
  deleteExamSession: (...args) => deleteExamSessionMock(...args),
}));

vi.mock("../../../questionPool.js", () => ({ releaseSessionQuestions: vi.fn() }));

vi.mock("../../../stores/weakConcepts.js", () => ({
  read: (...args) => readWeakConceptsMock(...args),
}));

vi.mock("../../../stores/learnerEvidence.js", () => ({
  read: (...args) => readLearnerEvidenceMock(...args),
  subscribe: () => () => {},
}));
vi.mock("../../../stores/calibrationByBlock.js", () => ({
  readBlock: () => [{ts:1,concept:'Study question',correct:true}],
  subscribe: () => () => {},
}));

const { ExamDashboard, computeObjectiveReadiness, computePacingMetrics } = await import("./ExamDashboard.jsx");

describe("computeObjectiveReadiness", () => {
  it("reports objective coverage, accuracy, ready, and weak counts", () => {
    const sessions = [{
      questions: [
        { questionId: "q1", correct: "A", objectiveIds: ["o1"] },
        { questionId: "q2", correct: "A", objectiveIds: ["o1"] },
        { questionId: "q3", correct: "A", objectiveIds: ["o2"] },
        { questionId: "q4", correct: "A", objectiveIds: ["o2"] },
      ],
      answers: [
        { questionId: "q1", value: "A" }, { questionId: "q2", value: "A" },
        { questionId: "q3", value: "B" }, { questionId: "q4", value: "B" },
      ],
    }];
    expect(computeObjectiveReadiness(sessions, [{ id: "o1" }, { id: "o2" }, { id: "o3" }])).toMatchObject({
      tested: 2, total: 3, ready: 1, weak: 1, accuracy: 0.5,
    });
  });
});

describe("computePacingMetrics", () => {
  it("reports overall pace, unanswered items, and accuracy by exam quarter", () => {
    const questions = Array.from({ length: 8 }, (_, i) => ({ questionId: `q${i}`, correct: "A" }));
    const answers = questions.slice(0, 7).map((q, i) => ({ questionId: q.questionId, value: i < 4 ? "A" : "B" }));
    const out = computePacingMetrics([{ questions, answers, startedAt: 1000, submittedAt: 121000 }]);
    expect(out.secondsPerQuestion).toBeCloseTo(120 / 7);
    expect(out.unanswered).toBe(1);
    expect(out.quarters[0].accuracy).toBe(1);
    expect(out.quarters[3].accuracy).toBe(0);
  });
});

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
  readLearnerEvidenceMock.mockReturnValue({ testTaking: { reasons: {}, timedAnswers: 0, totalResponseMs: 0, answerChanges: 0 } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ExamDashboard", () => {
  it("shows school homework in the 1000-question goal without mixing exam analytics", async () => {
    listExamSessionsMock.mockResolvedValue([{
      sessionId:'school', status:'submitted', sourceType:'question-bank',
      questions:[{questionId:'q1',correct:'A',choices:{A:'First',B:'Second'}}],
      answers:[{questionId:'q1',value:'B'}],
    }]);
    const {host, unmount} = render(<ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} />);
    await flush();
    const card=host.querySelector('[aria-label="Overall block question progress"]');
    expect(card.textContent).toContain('2 / 1,000 questions');
    expect(card.textContent).toContain('998 to goal');
    expect(card.textContent).toContain('Overall accuracy: 50%');
    expect(card.textContent).toContain('1 school homework / exam answers');
    expect(card.querySelector('progress').getAttribute('value')).toBe('2');
    unmount();
  });
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

  it("computes per-lecture accuracy using answered questions only", async () => {
    const sessionA = makeSession({
      id: "s1",
      questions: [q("q1", "lec-1"), q("q2", "lec-1"), q("q3", "lec-1")],
      // q1 correct, q2 wrong, q3 unanswered (not graded)
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

    // 3 answered questions, 1 miss -> 67% accuracy
    expect(host.textContent).toMatch(/Lecture One/);
    expect(host.textContent).toMatch(/3 questions/);
    expect(host.textContent).toMatch(/67%/);
    unmount();
  });

  it("offers model repair for stored weak lectures and objectively low exam accuracy", async () => {
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
    expect(lecTwoRow.querySelector("button")).toBeTruthy();
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

  it("I7 fix: a rejected listExamSessions fetch shows a visible error instead of hanging on 'Loading…' forever", async () => {
    listExamSessionsMock.mockRejectedValue(new Error("firestore unavailable"));

    const { host, unmount } = render(
      <ExamDashboard blockId={BLOCK} userId={USER} lecturesById={LECTURES} onNavigateToLecture={vi.fn()} />
    );
    await flush();

    expect(host.textContent).not.toMatch(/Loading/);
    expect(host.querySelector('[data-testid="exam-dashboard-error"]')).toBeTruthy();
    expect(host.textContent).toMatch(/firestore unavailable/);
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
