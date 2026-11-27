import { describe, expect, it } from "vitest";
import { sameChoices } from "./sameChoices.js";

describe("sameChoices", () => {
  it("ignores key order", () => expect(sameChoices({ A: "x", B: "y" }, { B: "y", A: "x" })).toBe(true));
  it("still tells different choices apart", () => {
    expect(sameChoices({ A: "x", B: "y" }, { A: "y", B: "x" })).toBe(false);
    expect(sameChoices({ A: "x" }, { A: "x", B: "y" })).toBe(false);
  });
  it("treats missing choices as empty", () => expect(sameChoices(undefined, {})).toBe(true));
});
