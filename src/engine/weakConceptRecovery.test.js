import { describe, expect, it } from "vitest";
import { reconcileWeakConceptRecovery } from "./weakConceptRecovery.js";

const answer = (id, at, correct, overrides = {}) => ({
  eventId: id,
  questionKey: id,
  at,
  correct,
  blockId: "b1",
  lectureId: "l1",
  objectiveIds: ["o1"],
  ...overrides,
});

describe("reconcileWeakConceptRecovery", () => {
  it('is stable across repeated refreshes after a new miss',()=>{
    const store={b1:[{id:'c',objectiveIds:['o1'],lastMissed:new Date(1000).toISOString()}]};
    const events=[answer('q1',2000,false),answer('q2',3000,true),answer('q3',4000,true)];
    const first=reconcileWeakConceptRecovery(store,events);
    expect(reconcileWeakConceptRecovery(first,events)).toBe(first);
    expect(first.b1[0].consecutiveCorrect).toBe(2);
  });
  it("moves an objective-mapped concept through developing and mastered using fresh answers after the miss", () => {
    const missedAt = new Date(1000).toISOString();
    const store = { b1: [{ id: "c1", concept: "pupillary reflex", blockId: "b1", objectiveIds: ["o1"], linkedLecIds: ["l1"], lastMissed: missedAt, masteryLevel: "struggling", consecutiveCorrect: 0 }] };
    const developing = reconcileWeakConceptRecovery(store, [answer("q1", 2000, true), answer("q2", 3000, true)]);
    expect(developing.b1[0]).toMatchObject({ masteryLevel: "developing", consecutiveCorrect: 2 });
    const mastered = reconcileWeakConceptRecovery(store, [answer("q1", 2000, true), answer("q2", 3000, true), answer("q3", 4000, true), answer("q4", 5000, true)]);
    expect(mastered.b1[0]).toMatchObject({ masteryLevel: "mastered", consecutiveCorrect: 4 });
  });

  it("does not clear one objective with an unrelated correct answer from the same lecture", () => {
    const store = { b1: [{ id: "c1", blockId: "b1", objectiveIds: ["o1"], linkedLecIds: ["l1"], lastMissed: new Date(1000).toISOString(), masteryLevel: "struggling" }] };
    const next = reconcileWeakConceptRecovery(store, [answer("q-other", 2000, true, { objectiveIds: ["o2"] })]);
    expect(next).toBe(store);
  });

  it("uses lecture evidence for legacy concepts only when they have no objective mapping", () => {
    const concept = { id: "legacy", blockId: "b1", objectiveIds: [], linkedLecIds: ["l1"], lastMissed: new Date(1000).toISOString(), masteryLevel: "struggling" };
    const next = reconcileWeakConceptRecovery({ b1: [concept] }, [answer("q1", 2000, true), answer("q2", 3000, true)]);
    expect(next.b1[0].masteryLevel).toBe("developing");
  });

  it("resets recovery after a fresh mapped miss and ignores repeated questions and assisted answers", () => {
    const concept = { id: "c1", blockId: "b1", objectiveIds: ["o1"], linkedLecIds: ["l1"], lastMissed: new Date(1000).toISOString(), masteryLevel: "struggling" };
    const next = reconcileWeakConceptRecovery({ b1: [concept] }, [
      answer("q1", 2000, true),
      answer("q1-repeat", 2500, true, { questionKey: "q1" }),
      answer("helped", 3000, true, { assisted: true }),
      answer("q2", 4000, true),
      answer("q3", 5000, false),
    ]);
    expect(next.b1[0]).toMatchObject({ masteryLevel: "struggling", consecutiveCorrect: 0, lastMissed: new Date(5000).toISOString() });
    expect(next.b1[0].recoveryEvidence).toHaveLength(3);
  });

  it("does not let evidence from before the recorded weakness clear it", () => {
    const concept = { id: "report", blockId: "b1", objectiveIds: ["o1"], linkedLecIds: ["l1"], lastMissed: new Date(5000).toISOString(), masteryLevel: "struggling" };
    const next = reconcileWeakConceptRecovery({ b1: [concept] }, [answer("old1", 1000, true), answer("old2", 2000, true), answer("old3", 3000, true), answer("old4", 4000, true)]);
    expect(next.b1[0].masteryLevel).toBe("struggling");
  });
});
