import { describe, expect, it } from "vitest";
import { buildMentalModelPrompt, generateMentalModel } from "./mentalModel.js";

const atoms = [
  { type: "mechanism", term: "RAAS activation", content: "Low renal perfusion triggers renin release." },
  { type: "relationship", term: "Angiotensin II - aldosterone", content: "Angiotensin II stimulates aldosterone secretion." },
];

describe("buildMentalModelPrompt", () => {
  it("includes every atom's type, term, and content", () => {
    const prompt = buildMentalModelPrompt({ atoms, subject: "RAAS" });
    expect(prompt).toContain("RAAS");
    expect(prompt).toContain("[mechanism] RAAS activation: Low renal perfusion triggers renin release.");
    expect(prompt).toContain("[relationship] Angiotensin II - aldosterone: Angiotensin II stimulates aldosterone secretion.");
  });
});

describe("generateMentalModel", () => {
  it("refuses to build a framework with no atoms", async () => {
    const result = await generateMentalModel({ atoms: [] }, { callAIJSON: async () => ({}) });
    expect(result.error).toMatch(/extract atoms first/);
    expect(result.model).toBeNull();
  });

  it("normalizes a well-formed response into all seven sections", async () => {
    const raw = {
      bigPicture: "RAAS regulates blood pressure and volume.",
      components: [{ name: "Renin", role: "enzyme", atomTerms: ["RAAS activation"] }],
      relationships: [{ from: "Angiotensin II", to: "Aldosterone", connection: "stimulates", why: "raises Na+ reabsorption", atomTerms: [] }],
      mechanisms: [],
      causeEffect: [],
      clinicalApplication: [],
      confusedPairs: [],
    };
    const result = await generateMentalModel({ atoms, subject: "RAAS" }, { callAIJSON: async () => raw });
    expect(result.error).toBeUndefined();
    expect(result.model.bigPicture).toBe(raw.bigPicture);
    expect(result.model.components).toEqual(raw.components);
    expect(result.model.relationships[0].why).toBe("raises Na+ reabsorption");
  });

  it("reports an error when the model returns nothing usable", async () => {
    const result = await generateMentalModel({ atoms }, { callAIJSON: async () => ({}) });
    expect(result.error).toMatch(/No framework/);
    expect(result.model).toBeNull();
  });
});
