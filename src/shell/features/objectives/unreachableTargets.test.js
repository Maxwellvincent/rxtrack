import { describe, expect, it } from "vitest";
import { countUnreachableTargetRejections, relaxUnreachableTargets } from "./quizLaunch.js";

describe("unreachable depth targets", () => {
  const plan = [
    { id: "differentiate", _targetOrder: "third-order", _transferOrder: "third-order", _targetQuestionCount: 5 },
    { id: "management", _targetOrder: "second-order", _connectionTargetIds: ["relationship-1"], _targetQuestionCount: 5 },
    { id: "fine", _targetOrder: "second-order", _targetQuestionCount: 2 },
  ];

  it("counts only depth/connection rejections per objective", () => {
    const counts = countUnreachableTargetRejections(new Map(), [
      { objectiveIds: ["differentiate"], issues: ["order_level_mismatch"] },
      { objectiveIds: ["differentiate"], issues: ["insufficient_reasoning_depth"] },
      { objectiveIds: ["management"], issues: ["connection_target_unverified"] },
      { objectiveIds: ["fine"], issues: ["incorrect_key"] },
    ]);
    expect(Object.fromEntries(counts)).toEqual({ differentiate: 2, management: 1 });
  });

  it("after two failures asks for a second-order item instead of stalling the quiz", () => {
    const counts = new Map([["differentiate", 2], ["management", 2], ["fine", 5]]);
    const { plan: next, relaxed } = relaxUnreachableTargets(plan, counts);
    expect(relaxed).toEqual(["differentiate", "management"]);
    expect(next[0]).toMatchObject({ _targetOrder: "second-order", _transferOrder: "second-order", _depthRelaxed: true, _targetQuestionCount: 5 });
    expect(next[1]._connectionTargetIds).toBeUndefined();
    expect(next[2]).toBe(plan[2]);
  });

  it("leaves targets alone below the threshold and never relaxes twice", () => {
    expect(relaxUnreachableTargets(plan, new Map([["differentiate", 1]])).relaxed).toEqual([]);
    const once = relaxUnreachableTargets(plan, new Map([["differentiate", 3]])).plan;
    expect(relaxUnreachableTargets(once, new Map([["differentiate", 9]])).relaxed).toEqual([]);
  });
});
