import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { generateExamQuestions, alreadyUsed } from "./generation.js";
const generate = vi.hoisted(() => vi.fn());
vi.mock("../objectives/quizLaunch.js", () => ({ startObjectiveQuiz: (...a) => generate(...a), readExemplarsForBlock: () => [], resolveDefaultDifficulty: () => "medium" }));
const q = stem => ({ stem, choices: { A: "yes", B: "no" }, correct: "A" });
const args = { allocation: { l1: 1, l2: 1, l3: 1 }, lecturesById: {}, objectivesByLecture: {}, atomsByLecture: {}, blockId: "b", lectures: [], userId: null, generationId: "g" };
const pool = () => ({ history: vi.fn(async () => []), ready: vi.fn(async () => []), save: vi.fn(async question => ({ ...question, poolId: question.questionId })) });
beforeEach(() => { generate.mockReset(); });
afterEach(() => vi.useRealTimers());
describe("parallel generation with durable reuse", () => {
  it("runs exactly two concurrent workers and finishes three delayed lectures in two waves", async () => {
    vi.useFakeTimers();
    let active = 0, peak = 0, count = 0;
    generate.mockImplementation(async () => {
      active++; peak = Math.max(peak, active); const id = ++count;
      await new Promise(resolve => setTimeout(resolve, 100)); active--;
      return { questions: [q(`Distinct${id}`)] };
    });
    const result = generateExamQuestions(args);
    await vi.advanceTimersByTimeAsync(100);
    expect(count).toBe(3);
    expect(peak).toBe(2);
    await vi.advanceTimersByTimeAsync(100);
    expect((await result).questions).toHaveLength(3);
  });
  it("uses prepared questions without AI and persists newly generated questions", async () => {
    const storage = pool();
    storage.ready.mockResolvedValueOnce([{ ...q("Stored"), poolId: "saved", lectureId: "l1" }]);
    generate.mockResolvedValue({ questions: [q("Fresh")] });
    const result = await generateExamQuestions({ ...args, allocation: { l1: 1, l2: 1 } }, { pool: storage });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(result.cacheHits).toBe(1);
    expect(result.questions).toHaveLength(2);
  });
  it("rejects repeated and overgenerated questions across workers", async () => {
    generate.mockResolvedValue({ questions: [q("Identical"), q("Identical")] });
    const result = await generateExamQuestions({ ...args, allocation: { l1: 1, l2: 1 } });
    expect(result.questions).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });
  it("stops queued generation after a timeout instead of multiplying retries", async () => {
    vi.useFakeTimers(); generate.mockImplementation(() => new Promise(() => {}));
    const result = generateExamQuestions(args, { requestTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    expect((await result).errors).toHaveLength(3);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("recognizes older truncated quiz history", () => {
    const stem = "A long clinical vignette containing enough information to identify the original question and its clinical context.";
    expect(alreadyUsed(q(stem), [{ stem: stem.slice(0, 100) }])).toBe(true);
  });
});
