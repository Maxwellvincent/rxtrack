import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import { AtomQuiz, objectivesToReview, Summary } from "./AtomQuiz.jsx";
import { ExamLaunchModal } from "./features/exam/ExamLaunchModal.jsx";
import { recordReflection } from "../stores/learnerEvidence.js";

vi.mock("../stores/learnerEvidence.js", () => ({ recordEvidence: vi.fn(), recordReflection: vi.fn() }));
vi.mock("../engine/calibrationStore.js", () => ({ appendCalibration: vi.fn() }));
vi.mock("./hooks/useFocusHudSignal.js", () => ({ useFocusHudSignal: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { installDomStorage(); vi.clearAllMocks(); });
function render(ui) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  return { host, close: () => act(() => root.unmount()) };
}
function click(host, text) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent.includes(text));
  expect(button).toBeTruthy();
  act(() => button.click());
}
describe("quiz feedback", () => {
  it("shows selection and the revealed correct/your-answer labels like Exam mode", () => {
    const { host, close } = render(<AtomQuiz userId={null} questions={[{ stem: "Which choice is correct?", choices: { A: "Wrong", B: "Correct" }, correct: "B" }]} />);
    click(host, "Wrong");
    expect(host.textContent).toContain("SELECTED");
    click(host, "Certain");
    expect(host.textContent).toContain("✓ CORRECT");
    expect(host.textContent).toContain("✕ YOUR ANSWER");
    close();
  });
  it("starts a quiz without reopening highlights from an earlier attempt", () => {
    const { host, close } = render(<AtomQuiz userId={null} questions={[{ stem: "A highlighted question", highlights: [{ start: 0, end: 11 }], choices: { A: "Correct", B: "Wrong" }, correct: "A" }]} />);
    expect(host.querySelector('[data-highlight="true"]')).toBeNull();
    close();
  });
  it("renders a recoverable state if a question set temporarily becomes empty", () => {
    const { host, close } = render(<AtomQuiz userId={null} questions={[]} onExit={vi.fn()} />);
    expect(host.textContent).toContain("no available question");
    close();
  });
  it("records activity only after an answer is submitted, never from merely opening the quiz", () => {
    const onAnswer = vi.fn();
    const { host, close } = render(<AtomQuiz userId={null} onAnswer={onAnswer} questions={[{ stem: "A sample question?", choices: { A: "Correct", B: "Wrong" }, correct: "A" }]} />);
    expect(onAnswer).not.toHaveBeenCalled();
    click(host, "Correct");
    expect(onAnswer).not.toHaveBeenCalled();
    click(host, "Certain");
    expect(onAnswer).toHaveBeenCalledOnce();
    close();
  });
  it("waits at the current last question while reviewed background questions are still arriving", () => {
    const { host, close } = render(<AtomQuiz userId={null} expectedCount={10} preparing questions={[{ stem: "A sample question?", choices: { A: "Correct", B: "Wrong" }, correct: "A" }]} />);
    click(host, "Correct");
    click(host, "Certain");
    const waiting = [...host.querySelectorAll("button")].find((button) => button.textContent.includes("Preparing next question"));
    expect(waiting).toBeTruthy();
    expect(waiting.disabled).toBe(true);
    expect(host.textContent).toContain("1/10 · preparing more");
    close();
  });
  it("allows changing a miss reason and passes the previous reason for replacement", () => {
    const { host, close } = render(<AtomQuiz userId={null} questions={[{ stem: "A sample question?", choices: { A: "Correct", B: "Wrong" }, correct: "A" }]} />);
    click(host, "Wrong");
    click(host, "Certain");
    click(host, "Knowledge gap");
    click(host, "Time pressure");
    expect(recordReflection.mock.calls[1]).toEqual([null, "time-pressure", "knowledge-gap"]);
    expect([...host.querySelectorAll('[aria-pressed="true"]')].some((b) => b.textContent === "Time pressure")).toBe(true);
    click(host, "Time pressure");
    expect(recordReflection).toHaveBeenCalledTimes(2);
    close();
  });
  it("puts overall accuracy first and moves confidence analysis out of each quiz", () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ correct: i < 6, confidence: 3, atomKey: `a${i}`, concept: `Concept ${i}` }));
    const { host, close } = render(<Summary records={records} />);
    expect(host.textContent).toContain("60%");
    expect(host.textContent).toContain("6 / 10 correct");
    expect(host.textContent).not.toContain('Accuracy by confidence');
    close();
  });
  it("groups missed questions under their full school objectives before supporting facts", () => {
    const records = [
      {
        correct: false,
        confidence: 5,
        atomKey: "urea",
        concept: "Urea",
        objectiveIds: ["obj-urea"],
        objectiveTexts: [{ id: "obj-urea", code: "SOM.DM.BIOC.104", text: "Explain nitrogen disposal through the urea cycle." }],
      },
      {
        correct: false,
        confidence: 2,
        atomKey: "glutamine",
        concept: "Glutamine",
        objectiveIds: ["obj-urea"],
        objectiveTexts: [{ id: "obj-urea", code: "SOM.DM.BIOC.104", text: "Explain nitrogen disposal through the urea cycle." }],
      },
      {
        correct: true,
        confidence: 4,
        atomKey: "cps1",
        concept: "CPS I",
        objectiveIds: ["obj-urea"],
        objectiveTexts: [{ id: "obj-urea", code: "SOM.DM.BIOC.104", text: "Explain nitrogen disposal through the urea cycle." }],
      },
    ];
    expect(objectivesToReview(records)).toEqual([expect.objectContaining({
      id: "obj-urea",
      misses: 2,
      landmines: 1,
      concepts: ["Urea", "Glutamine"],
    })]);

    const { host, close } = render(<Summary records={records} />);
    expect(host.textContent).toContain("1 school objective to review");
    expect(host.textContent).toContain("Explain nitrogen disposal through the urea cycle.");
    expect(host.textContent).toContain("2 questions missed");
    expect(host.textContent).toContain("Review through: Urea · Glutamine");
    expect(host.textContent.indexOf("school objective to review")).toBeLessThan(host.textContent.indexOf("supporting facts to repair"));
    close();
  });
  it("carries objective wording from an answered question into the result summary", () => {
    const question = {
      stem: "Which pathway handles this nitrogen load?",
      choices: { A: "Urea cycle", B: "Glycolysis" },
      correct: "A",
      atomKey: "urea-cycle",
      topic: "Urea cycle",
      objectiveIds: ["obj-1"],
      objectiveTexts: [{ id: "obj-1", code: "SOM.DM.1", text: "Explain the urea cycle and its regulation." }],
    };
    const { host, close } = render(<AtomQuiz userId={null} questions={[question]} />);
    click(host, "Glycolysis");
    click(host, "Certain");
    click(host, "See results");
    expect(host.textContent).toContain("Explain the urea cycle and its regulation.");
    close();
  });
  it("shows real generation counts, elapsed time, and locks settings while busy", () => {
    const { host, close } = render(<ExamLaunchModal launching progress={{ completed: 7, total: 30, message: "Generating lecture 8/29" }} />);
    expect(host.querySelector('[role="status"]').textContent).toContain("7/30 questions prepared");
    expect(host.textContent).toContain("Generating lecture 8/29");
    expect(host.textContent).toContain("0:00");
    expect(host.querySelector("fieldset").disabled).toBe(true);
    close();
  });
  it("keeps actionable errors inside the modal", () => {
    const { host, close } = render(<ExamLaunchModal error="Exam storage access was denied." />);
    expect(host.querySelector('[role="dialog"] [role="alert"]').textContent).toContain("storage access");
    close();
  });
});
