import { describe, it, expect } from "vitest";
import { encodeDocId, decodeDocId } from "./idCodec";

describe("idCodec", () => {
  const cases = [
    "a/b",
    "with space",
    "dot.dot",
    "__leading",
    "x".repeat(200),
  ];

  for (const x of cases) {
    it(`round-trips ${JSON.stringify(x.length > 20 ? x.slice(0, 20) + "…" : x)}`, () => {
      expect(decodeDocId(encodeDocId(x))).toBe(x);
    });
  }
});
