import { describe, expect, it } from "vitest";
import { ladderForObjective, LADDER_RUNGS, blockLadderSummary, ladderStepPrompt } from "./masteryLadder.js";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 10, 20);
const answer = (n, correct, extra = {}) => ({ questionKey: `q${n}`, correct, at: t0 + n * 60_000, orderLevel: "first-order", taskType: "recognition", reasoningVerified: true, ...extra });
const app = (n, correct, extra = {}) => answer(n, correct, { orderLevel: "second-order", taskType: "clinical-application", ...extra });
const disc = (n, correct, extra = {}) => answer(n, correct, { orderLevel: "second-order", taskType: "discrimination", ...extra });
const integ = (n, correct, extra = {}) => answer(n, correct, { orderLevel: "third-order", taskType: "clinical-application", ...extra });

describe("ladderForObjective", () => {
  it("starts unseen and asks for a recall question", () => {
    expect(ladderForObjective(null, { now: t0 })).toMatchObject({ rung: 0, label: "Unseen", next: { step: "recall", targetOrder: "first-order" } });
  });

  it("climbs recall -> application -> discrimination -> integration with the required streaks", () => {
    expect(ladderForObjective({ recentFreshAnswers: [answer(1, true)] }, { now: t0 }).rung).toBe(1);
    expect(ladderForObjective({ recentFreshAnswers: [answer(1, true), app(2, true)] }, { now: t0 })).toMatchObject({ rung: 1, progress: "1/2" });
    const two = { recentFreshAnswers: [answer(1, true), app(2, true), app(3, true)] };
    expect(ladderForObjective(two, { now: t0 })).toMatchObject({ rung: 2, label: "Application", next: { step: "discrimination", taskType: "discrimination" } });
    const three = { recentFreshAnswers: [...two.recentFreshAnswers, disc(4, true, { confidence: 5 }), disc(5, true, { confidence: 3 })] };
    expect(ladderForObjective(three, { now: t0 })).toMatchObject({ rung: 3, next: { step: "integration", targetOrder: "third-order" } });
    const four = { recentFreshAnswers: [...three.recentFreshAnswers, integ(6, true)] };
    expect(ladderForObjective(four, { now: t0 })).toMatchObject({ rung: 4, label: "Integration", next: { step: "retention" } });
  });

  it("does not count discrimination without at least one confident answer", () => {
    const e = { recentFreshAnswers: [answer(1, true), app(2, true), app(3, true), disc(4, true, { confidence: 2 }), disc(5, true, { confidence: 3 })] };
    expect(ladderForObjective(e, { now: t0 })).toMatchObject({ rung: 2 });
  });

  it("counts a low-confidence correct as half a step", () => {
    const e = { recentFreshAnswers: [answer(1, true), app(2, true, { confidence: 2 }), app(3, true, { confidence: 2 })] };
    expect(ladderForObjective(e, { now: t0 })).toMatchObject({ rung: 1, progress: "1/2" });
  });

  it("drops one rung on a miss and asks for a repair variant", () => {
    const e = { recentFreshAnswers: [answer(1, true), app(2, true), app(3, true), disc(4, false)] };
    expect(ladderForObjective(e, { now: t0 })).toMatchObject({ rung: 1, repairDue: true, next: { step: "application", repair: true } });
  });

  it("drops two rungs on a confident miss and asks for a misconception repair", () => {
    const e = { recentFreshAnswers: [answer(1, true), app(2, true), app(3, true), disc(4, false, { confidence: 5 })] };
    expect(ladderForObjective(e, { now: t0 })).toMatchObject({ rung: 0, repairDue: true, misconceptionDue: true, next: { step: "recall", repair: true, misconception: true } });
    const unsure = { recentFreshAnswers: [answer(1, true), app(2, true), app(3, true), disc(4, false, { confidence: 3 })] };
    expect(ladderForObjective(unsure, { now: t0 })).toMatchObject({ rung: 1, misconceptionDue: false });
    expect(ladderForObjective({ recentFreshAnswers: [...e.recentFreshAnswers, answer(5, true)] }, { now: t0 })).toMatchObject({ rung: 1, misconceptionDue: false });
  });

  it("requires a delayed retest on a later day to reach Mastered, spaced to the exam date", () => {
    const climbed = [answer(1, true), app(2, true), app(3, true), disc(4, true, { confidence: 5 }), disc(5, true), integ(6, true)];
    const waiting = ladderForObjective({ recentFreshAnswers: climbed }, { now: t0 + DAY / 2, examDate: t0 + 10 * DAY });
    expect(waiting).toMatchObject({ rung: 4, retestDue: false });
    expect(waiting.retestDueAt).toBe(t0 + 6 * 60_000 + 2 * DAY);
    const soon = ladderForObjective({ recentFreshAnswers: climbed }, { now: t0, examDate: t0 + 3 * DAY });
    expect(soon.retestDueAt).toBe(t0 + 6 * 60_000 + DAY);
    const sameDay = ladderForObjective({ recentFreshAnswers: [...climbed, app(7, true)] }, { now: t0 });
    expect(sameDay.rung).toBe(4);
    const later = ladderForObjective({ recentFreshAnswers: [...climbed, app(7, true, { at: t0 + 2 * DAY })] }, { now: t0 + 2 * DAY });
    expect(later).toMatchObject({ rung: 5, label: "Mastered" });
  });

  it("ignores answers whose reasoning depth was not independently verified", () => {
    expect(ladderForObjective({ recentFreshAnswers: [app(1, true, { reasoningVerified: false })] }, { now: t0 }).rung).toBe(0);
  });

  it("names every rung", () => {
    expect(LADDER_RUNGS.map(r => r.label)).toEqual(["Unseen", "Recall", "Application", "Discrimination", "Integration", "Mastered"]);
  });
});

describe("blockLadderSummary", () => {
  it("counts objectives per rung and readiness weighted by school emphasis", () => {
    const objectives = [{ id: "a", _schoolEmphasis: 3 }, { id: "b" }];
    const evidence = { objectives: { a: { recentFreshAnswers: [answer(1, true), app(2, true), app(3, true), disc(4, true, { confidence: 5 }), disc(5, true), integ(6, true)] } } };
    const summary = blockLadderSummary(objectives, evidence, { now: t0 });
    expect(summary.counts).toMatchObject({ 0: 1, 4: 1 });
    expect(summary.readyShare).toBeCloseTo(4 / 5, 5);
  });
});

describe("ladder targeting and prompt", async () => {
  const { withLadderTargets } = await import("./masteryLadder.js");
  const objectives = [{ id: "a", objective: "Clinically differentiate the depressive disorders" }, { id: "b", objective: "Describe hypotheses regarding the role of sleep", _transferOrder: "second-order", _targetOrder: "second-order" }];
  const evidence = { objectives: { a: { recentFreshAnswers: [answer(1, true), app(2, true), app(3, true)] } } };

  it("targets each objective's next rung without overriding explicit repair targets", () => {
    const [a, b] = withLadderTargets(objectives, evidence, { now: t0 });
    expect(a).toMatchObject({ _ladderRung: 2, _ladderStep: "discrimination", _targetOrder: "second-order" });
    expect(b).toMatchObject({ _ladderRung: 0, _ladderStep: "recall", _targetOrder: "second-order" });
  });

  it("tells the writer how to build a discrimination item", () => {
    const prompt = ladderStepPrompt(withLadderTargets(objectives, evidence, { now: t0 }));
    expect(prompt).toMatch(/DISCRIMINATION/);
    expect(prompt).toMatch(/"taskType":"discrimination"|taskType "discrimination"/);
    expect(ladderStepPrompt([{ id: "x" }])).toBe("");
    expect(prompt).toMatch(/discriminationSet/);
    expect(prompt).toMatch(/3-4|3–4/);
  });
});

describe("misconception repair prompt", () => {
  it("passes the misconception flag to the writer", () => {
    const prompt = ladderStepPrompt([{ id: "o1", _ladderStep: "recall", _ladderRepair: true, _ladderMisconception: true }]);
    expect(prompt).toMatch(/"misconception":true/);
    expect(prompt).toMatch(/most tempting distractor/);
  });
});
