import { describe, expect, it } from "vitest";
import {
  buildFullTextForObjectiveAi,
  getSequentialObjectiveSlices,
  OBJECTIVE_AI_MAX_SECTION,
  OBJECTIVE_AI_OVERLAP,
  prepareTextForObjectiveExtraction,
} from "./objectiveTextForAi.js";

describe("prepareTextForObjectiveExtraction", () => {
  it("collapses newlines and trims ends", () => {
    expect(prepareTextForObjectiveExtraction("  a \n\n\n b  ")).toBe("a \n\n b");
  });
  it("returns empty for falsy", () => {
    expect(prepareTextForObjectiveExtraction("")).toBe("");
  });
});

describe("buildFullTextForObjectiveAi", () => {
  it("uses chunk join when chunks have markdown", () => {
    const chunks = [{ markdown: "  hello  " }, { text: "world" }];
    const out = buildFullTextForObjectiveAi("ignored", chunks, null);
    expect(out).toBe("hello \nworld");
  });
  it("uses getChunkBody when provided", () => {
    const chunks = [{ x: 1 }];
    const out = buildFullTextForObjectiveAi("fallback", chunks, () => "BODY");
    expect(out).toBe("BODY");
  });
  it("falls back to prepared full text when no chunk text", () => {
    expect(buildFullTextForObjectiveAi("  z  ", [], null)).toBe("z");
  });
});

describe("getSequentialObjectiveSlices", () => {
  it("returns single slice when short", () => {
    const s = "a".repeat(100);
    expect(getSequentialObjectiveSlices(s, 6000, 500)).toEqual([s]);
  });
  it("steps by maxSection - overlap", () => {
    const max = 10;
    const ov = 3;
    const text = "0123456789abcdefghijklmnop";
    const slices = getSequentialObjectiveSlices(text, max, ov);
    expect(slices[0]).toBe("0123456789");
    expect(slices[1]).toBe("789abcdefg");
    expect(slices.length).toBeGreaterThanOrEqual(2);
  });
  it("defaults match production constants", () => {
    const long = "x".repeat(OBJECTIVE_AI_MAX_SECTION + OBJECTIVE_AI_OVERLAP + 1);
    const slices = getSequentialObjectiveSlices(long);
    expect(slices[0].length).toBe(OBJECTIVE_AI_MAX_SECTION);
    expect(slices.length).toBeGreaterThanOrEqual(2);
  });
});
