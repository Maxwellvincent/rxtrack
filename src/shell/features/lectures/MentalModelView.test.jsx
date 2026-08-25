import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { MentalModelView } from "./LectureStudyFlow.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const model = {
  bigPicture: "RAAS regulates blood pressure and volume.",
  components: [{ name: "Renin", role: "protease", atomTerms: ["RAAS activation"] }],
  relationships: [{ from: "Angiotensin II", to: "Aldosterone", connection: "stimulates", why: "raises Na+ reabsorption", atomTerms: ["RAAS activation"] }],
  mechanisms: [{ name: "RAAS cascade", steps: ["Renin cleaves angiotensinogen", "ACE converts to angiotensin II"], atomTerms: [] }],
  causeEffect: [{ cause: "Low renal perfusion", effect: "Renin release", why: "juxtaglomerular cells sense low pressure", atomTerms: [] }],
  clinicalApplication: [{ scenario: "ACE inhibitor use in hypertension", connection: "blocks angiotensin II formation", atomTerms: [] }],
  confusedPairs: [{ a: "ACE inhibitors", b: "ARBs", distinction: "ACE inhibitors also block bradykinin breakdown, causing cough." }],
};

function mount(ui) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return container;
}

describe("MentalModelView", () => {
  installDomStorage();

  it("renders every section without throwing and wires atom-chip clicks", () => {
    let clicked = null;
    const container = mount(<MentalModelView model={model} onAtomClick={(term) => { clicked = term; }} />);
    expect(container.textContent).toContain("RAAS regulates blood pressure and volume.");
    expect(container.textContent).toContain("Angiotensin II → Aldosterone");
    expect(container.textContent).toContain("why: raises Na+ reabsorption");
    expect(container.textContent).toContain("Renin cleaves angiotensinogen");
    expect(container.textContent).toContain("ACE inhibitors");

    const chip = [...container.querySelectorAll("button")].find((b) => b.textContent === "RAAS activation");
    expect(chip).toBeTruthy();
    act(() => { chip.click(); });
    expect(clicked).toBe("RAAS activation");
  });

  it("renders nothing but does not crash when the model is empty", () => {
    const container = mount(<MentalModelView model={{}} onAtomClick={() => {}} />);
    expect(container.querySelector("div").children.length).toBe(0);
  });
});
