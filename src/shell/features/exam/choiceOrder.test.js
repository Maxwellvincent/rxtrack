import { describe, expect, it } from "vitest";
import { orderedChoiceEntries } from "./choiceOrder.js";

describe("orderedChoiceEntries", () => {
  it("renders choices in letter order without changing their values", () => {
    const choices = { E: "last", C: "middle", A: "first", D: "fourth", B: "second" };
    expect(orderedChoiceEntries(choices)).toEqual([
      ["A", "first"], ["B", "second"], ["C", "middle"], ["D", "fourth"], ["E", "last"],
    ]);
  });

  it("handles an empty choice map", () => {
    expect(orderedChoiceEntries()).toEqual([]);
  });
});
