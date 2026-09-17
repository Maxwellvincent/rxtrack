import { describe, expect, it } from "vitest";
import { buildOrderBlueprint, classifyQuestionOrder, objectiveOrderProfile, stampQuestionOrders } from "./questionOrder.js";

describe("question order blueprint", () => {
  it("uses objective Bloom levels as an order ceiling", () => {
    expect(objectiveOrderProfile({ objective: "Identify the enzyme" })).toMatchObject({ primary: "first-order", allowed: ["first-order", "second-order"] });
    expect(objectiveOrderProfile({ objective: "Analyze the pathway" })).toMatchObject({ primary: "third-order", allowed: ["second-order", "third-order"] });
  });

  it("allocates first, second and third order work when the curriculum supports it", () => {
    const blueprint = buildOrderBlueprint({
      objectives: [
        { id: "o1", bloom_level: 2, objective: "Explain regulation" },
        { id: "o2", bloom_level: 4, objective: "Analyze downstream effects" },
      ],
      count: 10,
    });
    expect(blueprint.targets).toEqual({ "first-order": 2, "second-order": 6, "third-order": 2 });
    expect(blueprint.hasThirdOrderObjective).toBe(true);
  });

  it("keeps a one-question blueprint within the requested count", () => {
    const blueprint = buildOrderBlueprint({ objectives: [{ bloom_level: 4, objective: "Analyze downstream effects" }], count: 1 });
    expect(blueprint.targets).toEqual({ "first-order": 1, "second-order": 0, "third-order": 0 });
  });

  it("classifies and stamps generated questions without claiming third order for a low-level objective", () => {
    const [question] = stampQuestionOrders([{
      stem: "A patient has low renal perfusion. Renin rises, angiotensin II increases, and aldosterone secretion follows. Which downstream change is expected?",
      objectiveIds: ["o1"],
      taskType: "prediction",
    }], [{ id: "o1", bloom_level: 2, objective: "Explain RAAS regulation" }]);
    expect(classifyQuestionOrder({ stem: question.stem, taskType: question.taskType }, { bloom_level: 4 })).toBe("third-order");
    expect(question.orderLevel).toBe("second-order");
    expect(question.bloomLevel).toBe(2);
  });
});
