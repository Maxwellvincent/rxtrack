import { describe, expect, it } from "vitest";
import { classifyLeadIn, extractLeadIn } from "./questionReading.js";

describe("extractLeadIn", () => {
  it("isolates the final task sentence", () => {
    expect(extractLeadIn("A patient has fatigue. Labs show low T4. Which mechanism explains this finding?"))
      .toBe("Which mechanism explains this finding?");
  });
  it("classifies what the final sentence is actually asking for", () => {
    expect(classifyLeadIn("A patient is ill. Which enzyme catalyzes this reaction?")).toBe("enzyme-pathway");
    expect(classifyLeadIn("A patient is ill. Which nerve was most likely injured?")).toBe("anatomy-structure");
  });
});
