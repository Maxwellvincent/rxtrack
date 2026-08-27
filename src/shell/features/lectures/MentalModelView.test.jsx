import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { installDomStorage } from "../../../stores/testEnv.js";
import { MentalModelView, MentalModelOverview } from "./LectureStudyFlow.jsx";

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

  it("puts the overview paragraph first and hides all lookup material behind one disclosure", () => {
    const container = mount(<MentalModelOverview model={model}><button>Tracking tool</button></MentalModelOverview>);
    const paragraph = container.querySelector("p");
    expect(paragraph.textContent).toBe(model.bigPicture);
    expect(paragraph.closest("details")).toBe(null);
    const reference = container.querySelector("details");
    expect(reference.querySelector("summary").textContent).toBe("Reference details");
    expect(reference.open).toBe(false);
    expect(reference.textContent).toContain("Renin");
    expect(reference.textContent).toContain("Tracking tool");
    expect(reference.textContent).not.toContain(model.bigPicture);
    act(() => { reference.querySelector("summary").click(); });
    expect(reference.open).toBe(true);
    expect([...reference.querySelectorAll("details")].every((d) => !d.open)).toBe(true);
  });

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
  it("starts every section and individual entry collapsed and toggles independently", () => {
    const container = mount(<MentalModelView model={model} />);
    const disclosures = [...container.querySelectorAll("details")];
    expect(disclosures).toHaveLength(13);
    expect(disclosures.every((d) => !d.open)).toBe(true);
    const components = disclosures.find((d) => d.querySelector("summary").textContent.startsWith("Components"));
    act(() => { components.querySelector("summary").click(); });
    expect(components.open).toBe(true);
    const renin = components.querySelector("details");
    expect(renin.open).toBe(false);
    act(() => { renin.querySelector("summary").click(); });
    expect(renin.open).toBe(true);
    expect(container.textContent).toContain("protease");
    act(() => { components.querySelector("summary").click(); });
    expect(components.open).toBe(false);
    expect(disclosures.filter((d) => d !== renin).every((d) => !d.open)).toBe(true);
  });
});
