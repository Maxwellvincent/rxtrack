import { describe, expect, it } from "vitest";
import {
  createTutorSession,
  finishTutorSession,
  pauseTutorSession,
  recordTutorTurn,
  resumeTutorSession,
  tickTutorSession,
  tutorSessionSummary,
  tutorStepPrompt,
  attachTutorCase,
  tutorPacingContext,
  extendTutorSession,
} from "./tutorSession.js";

describe("bounded tutor sessions", () => {
  it("builds a diagnosis-first prompt for the active reasoning step", () => {
    expect(tutorStepPrompt({
      step: "mechanism",
      objectiveText: "acute kidney injury",
      atomTerms: ["afferent arteriole", "GFR"],
    })).toMatchObject({
      label: "mechanism",
      prompt: expect.stringContaining("acute kidney injury"),
      scaffold: expect.stringContaining("afferent arteriole"),
      nextStep: "consequence",
    });
  });

  it("uses explicit question translation and depth prompts before mechanism", () => {
    expect(tutorStepPrompt({ step: "translate", objectiveText: "glycolysis" }).nextStep).toBe("depth");
    expect(tutorStepPrompt({ step: "depth", objectiveText: "glycolysis" })).toMatchObject({
      prompt: expect.stringContaining("What level"),
      nextStep: "mechanism",
    });
  });

  it("tracks the diagnostic miss taxonomy without discarding legacy fields", () => {
    const state = createTutorSession({ lectureId: "lec", objectiveIds: ["o1"], now: 10 });
    const next = recordTutorTurn(state, { objectiveId: "o1", missType: "mechanism", missTypes: ["depth", "content"] }, 20);
    expect(next.learnerProfile.diagnosticMisses).toEqual({ depth: 1, content: 1 });
    expect(next.learnerProfile.recentMisses[0].missType).toBe("mechanism");
  });

  it("queues one targeted card draft per unique gap", () => {
    let state = createTutorSession({ lectureId: "lec", objectiveIds: ["o1"], now: 10 });
    const draft = { front: "What connects A to B?", back: "A causes B." };
    state = recordTutorTurn(state, { objectiveId: "o1", ankiRecommendation: draft }, 20);
    state = recordTutorTurn(state, { objectiveId: "o1", ankiRecommendation: draft }, 30);
    expect(state.ankiQueue).toHaveLength(1);
    expect(state.ankiQueue[0]).toMatchObject({ ...draft, status: "queued" });
  });

  it("attaches a patient case and moves the session into diagnosis", () => {
    const state = createTutorSession({ lectureId: "lec", objectiveIds: ["o1"], now: 10 });
    expect(attachTutorCase(state, { caseTitle: "Case", stem: "A patient presents." }, 20, "Start with a model.")).toMatchObject({
      openingModel: "Start with a model.",
      patientCase: { caseTitle: "Case" },
      currentStep: "diagnosis",
      nextAction: "identify_diagnosis",
    });
  });

  it("creates a resumable session with a bounded budget", () => {
    const state = createTutorSession({ lectureId: "lec30", budgetMinutes: 45, objectiveIds: ["o1", "o1", "o2"], objectivePlan: [{ id: "o1", label: "First" }, { id: "o2", label: "Second" }], now: 100 });
    expect(state).toMatchObject({ lectureId: "lec30", budgetMinutes: 45, remainingSeconds: 2700, status: "active", activeObjectiveId: "o1" });
    expect(state.objectiveIds).toEqual(["o1", "o2"]);
    expect(tutorPacingContext(state)).toMatchObject({ mode: "balanced walkthrough", objectivesNotYetReached: 2, notYetReached: ["First", "Second"] });
  });

  it("preserves integration mode for lectures whose first-pass objectives are complete", () => {
    const state = createTutorSession({ lectureId: "nb02", objectiveIds: ["o1"], sessionMode: "integration", integrationSeed: "aqueduct obstruction", now: 100 });
    expect(state).toMatchObject({ sessionMode: "integration", integrationSeed: "aqueduct obstruction" });
    expect(tutorPacingContext(state)).toMatchObject({ sessionMode: "integration", coverageLabel: "All lecture objectives covered · integration/application" });
  });

  it("does not consume the study budget until a patient case or delayed-retrieval case exists", () => {
    const state = createTutorSession({ lectureId: "lec", objectiveIds: ["o1"], now: 100 });
    expect(tickTutorSession(state, 30, 130)).toBe(state);
    const ready = attachTutorCase(state, { caseTitle: "Patient 1", stem: "A patient presents." }, 140);
    expect(tickTutorSession(ready, 1, 141)).toMatchObject({ elapsedSeconds: 1, remainingSeconds: 1799 });
  });

  it("persists a blocker and objective progress without restarting", () => {
    let state = createTutorSession({ lectureId: "lec30", objectiveIds: ["o1", "o2"], now: 100 });
    state = recordTutorTurn(state, { objectiveId: "o1", blocker: { type: "R", concept: "urine bilirubin", status: "open" }, nextStep: "repair" }, 200);
    state = attachTutorCase(state, { caseTitle: "Case" }, 250);
    state = recordTutorTurn(state, { objectiveId: "o1", objectiveComplete: true, nextStep: "contrast" }, 300);
    expect(state.completedObjectiveIds).toEqual(["o1"]);
    expect(state.blockers).toHaveLength(1);
    expect(state).toMatchObject({ activeObjectiveId: "o2", currentStep: "retrieval", patientCase: null, nextAction: "build_patient_case" });
  });

  it("finishes after the final objective reasoning chain", () => {
    let state = createTutorSession({ lectureId: "lec", objectiveIds: ["o1"], now: 100 });
    state = recordTutorTurn(state, { objectiveId: "o1", objectiveComplete: true }, 200);
    expect(state).toMatchObject({ status: "finished", phase: "summary", activeObjectiveId: "o1", nextAction: "review_checkpoint" });
  });

  it("checkpoints at the time boundary and requires an explicit extension", () => {
    let state = createTutorSession({ lectureId: "lec30", budgetMinutes: 30, now: 100 });
    state = attachTutorCase(state, { caseTitle: "Patient 1", stem: "A patient presents." }, 150);
    state = recordTutorTurn(state, { objectiveId: "o1", nextStep: "bile" }, 200);
    state = tickTutorSession(state, 1800, 300);
    expect(state).toMatchObject({ status: "checkpoint", phase: "checkpoint", remainingSeconds: 0, currentStep: "bile" });
    expect(resumeTutorSession(state, 400)).toBe(state);
    state = extendTutorSession(state, 10, 400);
    expect(state).toMatchObject({ status: "active", phase: "resume", budgetMinutes: 40, remainingSeconds: 600, currentStep: "bile", nextAction: "retrieve_previous_state" });
  });

  it("reports completed, in-progress, and untouched objectives separately", () => {
    let state = createTutorSession({ lectureId: "lec", objectiveIds: ["o1", "o2", "o3"], objectivePlan: [
      { id: "o1", label: "Completed" }, { id: "o2", label: "Started" }, { id: "o3", label: "Untouched" },
    ], now: 100 });
    state = recordTutorTurn(state, { objectiveId: "o2", response: "reasoning attempt" }, 150);
    state = recordTutorTurn(state, { objectiveId: "o1", objectiveComplete: true }, 200);
    expect(tutorPacingContext(state)).toMatchObject({
      completed: ["Completed"], inProgress: ["Started"], notYetReached: ["Untouched"],
      objectivesCompleted: 1, objectivesInProgress: 1, objectivesNotYetReached: 1,
    });
  });

  it("supports pause/resume and reports unfinished work", () => {
    let state = createTutorSession({ lectureId: "lec30", budgetMinutes: 30, objectiveIds: ["o1", "o2"], now: 100 });
    state = pauseTutorSession(state, 150);
    expect(state.status).toBe("paused");
    state = resumeTutorSession(state, 200);
    state = finishTutorSession(state, 300);
    expect(tutorSessionSummary(state)).toMatchObject({ status: "finished", objectivesCompleted: 0, objectivesTotal: 2, nextAction: "review_checkpoint" });
  });
});
