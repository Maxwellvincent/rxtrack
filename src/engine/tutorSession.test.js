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
    const state = createTutorSession({ lectureId: "lec30", budgetMinutes: 45, objectiveIds: ["o1", "o1", "o2"], now: 100 });
    expect(state).toMatchObject({ lectureId: "lec30", budgetMinutes: 45, remainingSeconds: 2700, status: "active", activeObjectiveId: "o1" });
    expect(state.objectiveIds).toEqual(["o1", "o2"]);
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

  it("checkpoints at the time boundary and resumes from the same state", () => {
    let state = createTutorSession({ lectureId: "lec30", budgetMinutes: 30, now: 100 });
    state = recordTutorTurn(state, { objectiveId: "o1", nextStep: "bile" }, 200);
    state = tickTutorSession(state, 1800, 300);
    expect(state).toMatchObject({ status: "checkpoint", phase: "checkpoint", remainingSeconds: 0, currentStep: "bile" });
    state = resumeTutorSession(state, 400);
    expect(state).toMatchObject({ status: "active", phase: "resume", currentStep: "bile", nextAction: "retrieve_previous_state" });
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
