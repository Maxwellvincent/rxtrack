import { beforeEach, describe, expect, it, vi } from "vitest";

// Pure orchestration logic: mock the sibling functions this module calls
// into, following the same DI-via-vi.mock approach useExamSessionController.test.jsx
// uses for supabase.js/finalize.js.
const allocateQuestionsMock = vi.fn();
const generateExamQuestionsMock = vi.fn();
const createExamSessionMock = vi.fn();
const checkExamAccessMock = vi.fn();
vi.mock("../../../questionPool.js", () => ({ createQuestionPool: userId => ({
  begin: async () => {}, finish: async () => {},
  commit: session => createExamSessionMock(userId, session),
}) }));

vi.mock("./allocation.js", () => ({
  allocateQuestions: (...args) => allocateQuestionsMock(...args),
}));

vi.mock("./generation.js", () => ({
  generateExamQuestions: (...args) => generateExamQuestionsMock(...args),
}));

vi.mock("../../../supabase.js", () => ({
  createExamSession: (...args) => createExamSessionMock(...args),
  checkExamAccess: (...args) => checkExamAccessMock(...args),
}));

const { launchExamSession } = await import("./launchExam.js");

function makeQuestion(questionId, lectureId) {
  return {
    questionId,
    blockId: "b1",
    lectureId,
    objectiveIds: [],
    stem: `Stem ${questionId}`,
    choices: { A: "a", B: "b" },
    correct: "A",
    explanation: "Because.",
  };
}

const BASE_ARGS = {
  userId: "u1",
  blockId: "b1",
  format: "exam",
  questionCount: 10,
  durationMinutes: 30,
  eligibleLectures: [{ lectureId: "lec-1", objectiveCount: 3 }],
  objectivesByLecture: {},
  atomsByLecture: {},
  lecturesById: {},
  lectures: [],
  weakConceptAccuracyByLecture: {},
  weakConcepts: {},
};

beforeEach(() => {
  allocateQuestionsMock.mockReset();
  generateExamQuestionsMock.mockReset();
  createExamSessionMock.mockReset();
  checkExamAccessMock.mockReset();

  allocateQuestionsMock.mockReturnValue({ "lec-1": 10 });
});

describe("launchExamSession", () => {
  it("checks storage access before spending on generation", async () => {
    checkExamAccessMock.mockRejectedValue(new Error("Access denied"));
    await expect(launchExamSession(BASE_ARGS)).rejects.toThrow("Access denied");
    expect(generateExamQuestionsMock).not.toHaveBeenCalled();
    expect(createExamSessionMock).not.toHaveBeenCalled();
  });
  it("happy path: creates a session and returns its sessionId", async () => {
    generateExamQuestionsMock.mockResolvedValue({
      questions: [makeQuestion("q1", "lec-1"), makeQuestion("q2", "lec-1")],
      errors: [],
    });
    createExamSessionMock.mockResolvedValue({ ok: true });

    const result = await launchExamSession({ ...BASE_ARGS, questionCount: 2 });

    expect(result.ok).toBe(true);
    expect(result.sessionId).toEqual(expect.any(String));
    expect(result.sessionId.length).toBeGreaterThan(0);
    expect(result.generationErrors).toEqual([]);

    expect(createExamSessionMock).toHaveBeenCalledTimes(1);
    const [userId, session] = createExamSessionMock.mock.calls[0];
    expect(userId).toBe("u1");
    expect(session.lectureIds).toEqual(["lec-1"]);
    expect(session.questions).toHaveLength(2);
    expect(session.format).toBe("exam");
  });

  it("zero questions generated: returns ok:false without calling createExamSession", async () => {
    generateExamQuestionsMock.mockResolvedValue({ questions: [], errors: ["lec-1: no material"] });

    const result = await launchExamSession(BASE_ARGS);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Could not generate any questions/);
    expect(createExamSessionMock).not.toHaveBeenCalled();
  });

  it("partial timed generation stays saved without starting the exam", async () => {
    generateExamQuestionsMock.mockResolvedValue({
      questions: [makeQuestion("q1", "lec-1")],
      errors: ["lec-2: no material"],
    });
    createExamSessionMock.mockResolvedValue({ ok: true });

    const result = await launchExamSession(BASE_ARGS);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("1/10 questions are saved");
    expect(createExamSessionMock).not.toHaveBeenCalled();
  });

  it("propagates createExamSession failure instead of claiming success", async () => {
    generateExamQuestionsMock.mockResolvedValue({
      questions: [makeQuestion("q1", "lec-1")],
      errors: [],
    });
    createExamSessionMock.mockResolvedValue({ ok: false, error: "session too large" });

    const result = await launchExamSession({ ...BASE_ARGS, questionCount: 1 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("session too large");
    expect(result.sessionId).toBeUndefined();
  });

  it("practice format: startedAt and deadline are both null", async () => {
    generateExamQuestionsMock.mockResolvedValue({
      questions: [makeQuestion("q1", "lec-1")],
      errors: [],
    });
    createExamSessionMock.mockResolvedValue({ ok: true });

    await launchExamSession({ ...BASE_ARGS, format: "practice", durationMinutes: null });

    const [, session] = createExamSessionMock.mock.calls[0];
    expect(session.format).toBe("practice");
    expect(session.startedAt).toBeNull();
    expect(session.deadline).toBeNull();
  });

  it("exam format: deadline is computed correctly from durationMinutes", async () => {
    generateExamQuestionsMock.mockResolvedValue({
      questions: [makeQuestion("q1", "lec-1")],
      errors: [],
    });
    createExamSessionMock.mockResolvedValue({ ok: true });

    const before = Date.now();
    await launchExamSession({ ...BASE_ARGS, questionCount: 1, format: "exam", durationMinutes: 30 });
    const after = Date.now();

    const [, session] = createExamSessionMock.mock.calls[0];
    expect(session.startedAt).toBeGreaterThanOrEqual(before);
    expect(session.startedAt).toBeLessThanOrEqual(after);
    expect(session.deadline).toBe(session.startedAt + 30 * 60_000);
  });
  it("prepares questions without assigning them or starting a clock", async () => {
    generateExamQuestionsMock.mockResolvedValue({ questions: [makeQuestion("q1", "lec-1")], errors: [] });
    const result = await launchExamSession({ ...BASE_ARGS, prepareOnly: true });
    expect(result).toMatchObject({ ok: true, prepared: 1 });
    expect(result.sessionId).toBeUndefined();
    expect(createExamSessionMock).not.toHaveBeenCalled();
  });
});
