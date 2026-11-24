import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { QuestionExplanation } from "./QuestionExplanation.jsx";
import { installDomStorage } from "../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("QuestionExplanation", () => {
  it("condenses long source rationales and keeps full keyed choice notes available", () => {
    installDomStorage();
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<QuestionExplanation
      text="Phosphoglucomutase is keyed. INCORRECT ANSWERS: Choice A (Glycogen phosphorylase) is wrong because it forms G1P. Choice C (Glucose-6-phosphatase) is a liver enzyme. Choice D (Debranching enzyme) causes limit dextrin."
      correctLetter="B"
      choices={{ A: "Glycogen phosphorylase", B: "Phosphoglucomutase", C: "Glucose-6-phosphatase", D: "Debranching enzyme" }}
      sourceType="question-bank"
    />));
    expect(host.textContent).toContain("not independently medically verified");
    expect(host.textContent).toContain("Why B is correct · condensed from source");
    expect(host.querySelector("details")?.open).toBe(false);
    expect(host.querySelector(".rounded.border")?.textContent).not.toContain("causes limit dextrin");
    act(() => host.querySelector("summary").click());
    expect(host.querySelector('[aria-label="Answer-choice reasoning"]')?.children).toHaveLength(3);
    expect(host.textContent).toContain("causes limit dextrin");
    act(() => root.unmount());
  });
});

it("shows the decisive explanation and selected misconception without expanding every distractor", () => {
  installDomStorage();
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<QuestionExplanation text="The intact barrier and intracellular swelling indicate pump failure." correctLetter="B" selectedLetter="A"
    choices={{ A: "Permeability", B: "Pump failure", C: "CSF secretion", D: "Absorption" }}
    whyWrong={{ A: "Permeability causes extracellular leakage.", B: "The pump depends on ATP.", C: "CSF secretion does not explain cellular swelling.", D: "Absorption affects ventricular size." }} />));
  expect(host.querySelector("details").open).toBe(false);
  expect(host.querySelector("summary").textContent).toBe("Compare answer choices");
  expect(host.querySelector("details").previousElementSibling.textContent).toContain("Why your answer (A) is incorrect");
  expect(host.querySelector("details").previousElementSibling.textContent).toContain("extracellular leakage");
  expect(host.querySelector("details").textContent).toContain("Absorption affects ventricular size");
  act(() => root.unmount());
});

describe("inline answer-choice notes", () => {
  it("maps each choice to its own reasoning and keeps the general explanation as the lead", async () => {
    const { choiceNotes } = await import("./QuestionExplanation.jsx");
    const result = choiceNotes({
      text: "Polio destroys anterior horn cells. (A) Dorsal column carries vibration. (D) Anterior horn: lower motor neuron loss.",
      choices: { A: "Dorsal column", B: "Lateral corticospinal tract", D: "Anterior horn" }, correctLetter: "D",
    });
    expect(result.lead).toMatch(/Polio destroys/);
    expect(result.notes).toEqual({ A: "Dorsal column carries vibration.", D: "Anterior horn: lower motor neuron loss." });
  });

  it("prefers structured whyWrong notes and gives a source-bank key a condensed correct note", async () => {
    const { choiceNotes } = await import("./QuestionExplanation.jsx");
    expect(choiceNotes({ whyWrong: { A: "Too proximal.", B: "Correct mechanism." }, choices: { A: "x", B: "y" }, correctLetter: "B" }).notes).toEqual({ A: "Too proximal.", B: "Correct mechanism." });
    const source = choiceNotes({ text: "Because the medial lemniscus crosses in the medulla, the deficit is contralateral.", choices: { A: "Ipsilateral", B: "Contralateral" }, correctLetter: "B", sourceType: "question-bank" });
    expect(source.notes.B).toMatch(/medial lemniscus/);
  });

  it("shows only the general explanation below the choices when notes are inline", () => {
    const host = document.createElement("div"); const root = createRoot(host);
    act(() => root.render(<QuestionExplanation notesInline text="Polio destroys anterior horn cells. (A) Dorsal column carries vibration. (D) Anterior horn loss." correctLetter="D" selectedLetter="A" choices={{ A: "Dorsal column", D: "Anterior horn" }} />));
    expect(host.textContent).toContain("Polio destroys anterior horn cells.");
    expect(host.textContent).not.toContain("Why your answer");
    expect(host.textContent).not.toContain("Compare answer choices");
    act(() => root.unmount());
  });
});
