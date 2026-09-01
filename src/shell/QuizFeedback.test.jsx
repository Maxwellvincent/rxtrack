import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installDomStorage } from "../stores/testEnv.js";
import { AtomQuiz, Summary } from "./AtomQuiz.jsx";
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
