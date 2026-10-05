import { describe, expect, it } from "vitest";
import { buildOrderBlueprint, classifyQuestionOrder, objectiveOrderProfile, stampQuestionOrders, verifyReasoningReview } from "./questionOrder.js";

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

  it("follows application targets instead of imposing an early third-order quota", () => {
    expect(buildOrderBlueprint({ objectives: [{ id: "o1", bloom_level: 4, _targetOrder: "second-order" }], count: 5 }).targets)
      .toEqual({ "first-order": 0, "second-order": 5, "third-order": 0 });
  });
  it("respects per-objective quotas when an objective advances", () => {
    expect(buildOrderBlueprint({ objectives: [{ id: "o1", bloom_level: 3, _targetOrder: "third-order", _targetQuestionCount: 2 },
      { id: "o2", bloom_level: 2, _targetOrder: "second-order", _targetQuestionCount: 3 }], count: 5 }).targets)
      .toEqual({ "first-order": 0, "second-order": 3, "third-order": 2 });
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

describe("reasoning verification", () => {
  const cfg = { objectives: [{ id: "o1", bloom_level: 3 }], atoms: [
    { content: "Blockage of the cerebral aqueduct prevents CSF from reaching the fourth ventricle." },
    { content: "Continued CSF production causes expansion of the ventricles upstream of an obstruction." },
  ] };
  const question = { objectiveIds: ["o1"] };
  const review = { reasoning: { orderLevel: "third-order", allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false,
    steps: ["Localize the obstructed passage", "Trace the upstream CSF spaces", "Predict expansion with continued production"],
    sourceQuotes: cfg.atoms.map(atom => atom.content),
  } };
  it("verifies integration only with a necessary chain and both source relationships", () => {
    expect(verifyReasoningReview(review, question, cfg)).toMatchObject({ status: "verified", orderLevel: "third-order" });
  });
  it("rejects disconnected chains, compound endpoints, shortcuts and missing judgments", () => {
    for (const patch of [{ connectedChain: false }, { singleEndpoint: false }, { choiceShortcut: true }, { connectedChain: undefined }]) {
      expect(verifyReasoningReview({ reasoning: { ...review.reasoning, ...patch } }, question, cfg)).toBeNull();
    }
  });

  it("rejects padded recall, duplicate steps, invented quotes and unsupported third-order labels", () => {
    expect(verifyReasoningReview({ reasoning: { ...review.reasoning, allStepsRequired: false } }, question, cfg)).toBeNull();
    expect(verifyReasoningReview({ reasoning: { ...review.reasoning, steps: ["Recall aqueduct", "Recall aqueduct", "Recall aqueduct"] } }, question, cfg)).toBeNull();
    expect(verifyReasoningReview({ reasoning: { ...review.reasoning, sourceQuotes: ["A made-up source relationship with no support."] } }, question, cfg)).toBeNull();
    expect(verifyReasoningReview(review, question, { ...cfg, objectives: [{ id: "o1", bloom_level: 1 }] })).toBeNull();
  });
});
