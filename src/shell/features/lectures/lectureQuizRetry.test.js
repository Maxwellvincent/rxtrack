import { describe, expect, it } from "vitest";
import { pendingQuizAction } from "./lectureQuizRetry.js";

const questions = Array.from({ length: 8 }, (_, i) => ({ stem: `Question ${i + 1}` }));
const saved = { id: "s1", lectureId: "l", questions, requestedCount: 10, progress: { i: 5, records: [{}, {}, {}, {}, {}] } };

describe("short lecture quiz retry", () => {
  it("retry resumes the saved session with its answers instead of restarting at question 1", () => {
    const action = pendingQuizAction({ sessionId: "s1", questions, count: 10 }, [saved], "retry");
    expect(action.type).toBe("resume-and-prepare");
    expect(action.session.progress.i).toBe(5);
    expect(action.session.progress.records).toHaveLength(5);
  });
  it("start-with-ready resumes the saved session and accepts the shorter length", () => {
    const action = pendingQuizAction({ sessionId: "s1", questions, count: 10 }, [saved], "start");
    expect(action).toMatchObject({ type: "resume", session: { id: "s1", requestedCount: 8, progress: { i: 5 } } });
  });
  it("builds a new quiz only when no session was ever started", () => {
    expect(pendingQuizAction({ questions, count: 10 }, [saved], "retry")).toMatchObject({ type: "prepare", count: 10 });
    expect(pendingQuizAction({ sessionId: "gone", questions, count: 10 }, [], "start").type).toBe("new");
  });
});
