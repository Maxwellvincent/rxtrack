import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { QuestionExplanation } from "./QuestionExplanation.jsx";
import { installDomStorage } from "../stores/testEnv.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("QuestionExplanation", () => {
  it("separates source rationales by answer choice and labels bank keys honestly", () => {
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
    expect(host.querySelector('[aria-label="Answer-choice reasoning"]')?.children).toHaveLength(3);
    expect(host.textContent).toContain("causes limit dextrin");
    act(() => root.unmount());
  });
});
