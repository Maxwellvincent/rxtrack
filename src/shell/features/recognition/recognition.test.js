import { describe, expect, it } from "vitest";
import {
  objectivePoolFrom,
  weakConceptNames,
  pickAnchors,
  buildUserPrompt,
  isUsableCase,
} from "./recognition.js";

const store = {
  b1: {
    imported: [{ objective: "Describe the brachial plexus anatomy." }, { objective: "short" }],
    extracted: [{ text: "Explain glomerular filtration." }],
  },
  b2: [{ term: "Hypothalamic-pituitary axis regulation" }, { objective: "   " }],
};

describe("objectivePoolFrom", () => {
  it("flattens every entry shape into anchors tagged with their block", () => {
    const pool = objectivePoolFrom(store);
    expect(pool).toHaveLength(3);
    expect(pool[0]).toEqual({ text: "Describe the brachial plexus anatomy.", block: "b1" });
    expect(pool.map((p) => p.block)).toEqual(["b1", "b1", "b2"]);
  });

  it("scopes to one block when asked", () => {
    expect(objectivePoolFrom(store, "b2").map((p) => p.block)).toEqual(["b2"]);
  });

  it("drops stubs too short to build a case on", () => {
    expect(objectivePoolFrom(store).some((p) => p.text === "short")).toBe(false);
  });

  it("survives an empty or malformed store", () => {
    expect(objectivePoolFrom(null)).toEqual([]);
    expect(objectivePoolFrom({ b1: null })).toEqual([]);
  });
});

describe("weakConceptNames", () => {
  it("reads concept names across every block", () => {
    expect(
      weakConceptNames({ b1: [{ concept: "Preload" }, { subject: "Afterload" }], b2: [{ nothing: 1 }] })
    ).toEqual(["Preload", "Afterload"]);
  });

  it("takes a flat array too, and tolerates junk", () => {
    expect(weakConceptNames([{ concept: "Preload" }])).toEqual(["Preload"]);
    expect(weakConceptNames(null)).toEqual([]);
  });
});

describe("pickAnchors", () => {
  const pool = [{ text: "a" }, { text: "b" }, { text: "c" }];

  it("returns distinct anchors", () => {
    const picked = pickAnchors(pool, 2, seq([0, 0, 0.9]));
    expect(picked.map((p) => p.text)).toEqual(["a", "c"]);
  });

  it("never asks for more than the pool holds, and copes with an empty pool", () => {
    expect(pickAnchors(pool, 10, seq([0, 0.4, 0.9]))).toHaveLength(3);
    expect(pickAnchors([], 2)).toEqual([]);
  });

  function seq(values) {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
  }
});

describe("buildUserPrompt", () => {
  it("numbers the anchors it was given", () => {
    const prompt = buildUserPrompt([{ text: "Describe preload" }, { text: "Describe afterload" }]);
    expect(prompt).toContain("1. Describe preload");
    expect(prompt).toContain("2. Describe afterload");
  });

  it("falls back to the typed topic, then to a generic one", () => {
    expect(buildUserPrompt([], "heart failure")).toContain("heart failure");
    expect(buildUserPrompt([], "")).toContain("general high-yield preclinical medicine");
  });
});

describe("isUsableCase", () => {
  it("needs a stem and options", () => {
    expect(isUsableCase({ vignette: "case", options: [{ letter: "A" }] })).toBe(true);
    expect(isUsableCase({ vignette: "case", options: [] })).toBe(false);
    expect(isUsableCase({ options: [{}] })).toBe(false);
    expect(isUsableCase(null)).toBe(false);
  });
});
