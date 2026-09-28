import { describe, expect, it } from "vitest";
import { summarizePoolRows, summarizePreparedSets } from "./questionPool.js";

describe("question pool availability", () => {
  it("counts only unassigned questions as ready", () => {
    expect(summarizePoolRows([
      { status: "ready" },
      { status: "assigned" },
      { status: "used" },
    ])).toEqual({ ready: 1, assigned: 1, total: 3 });
  });

  it("lists persisted named sets but reports only their still-unused questions", () => {
    const sets = summarizePreparedSets([{
      id: "generation-1", prepareOnly: true, examName: "Later quiz", requestedCount: 3,
      preparedQuestionIds: ["q1", "q2"], createdAt: 100,
    }, {
      id: "generation-2", prepareOnly: false, requestedCount: 1,
    }], [{
      id: "q1", generationId: "older-run", status: "ready", bucket: "b1", question: { stem: "Still free" },
    }, {
      id: "q2", generationId: "generation-1", status: "assigned", bucket: "b1", question: { stem: "Already launched" },
    }]);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ id: "generation-1", examName: "Later quiz", requestedCount: 3, preparedCount: 2, assignedCount: 1 });
    expect(sets[0].questions).toHaveLength(1);
    expect(sets[0].questions[0]).toMatchObject({ poolId: "q1", stem: "Still free" });
  });

  it("does not call assigned questions a generation shortfall and hides a set once launched", () => {
    const base = [{
      id: "generation-1", prepareOnly: true, requestedCount: 2, preparedQuestionIds: ["q1", "q2"],
    }];
    const rows = ["q1", "q2"].map(id => ({ id, status: "assigned", generationId: "generation-1", question: { stem: id } }));
    expect(summarizePreparedSets(base, rows)).toEqual([]);
    expect(summarizePreparedSets([{ ...base[0], startedSessionId: "session-1" }], [
      { id: "q1", status: "ready", generationId: "generation-1", question: { stem: "q1" } },
    ])).toEqual([]);
  });
});
