import { describe, expect, it } from "vitest";
import { bankBlockIds, listedForBlock, markedExamBlockIds, withExamBlock } from "./bankExamBlocks.js";

const meta = {
  a: { filename: "NB IMCQ 7", blockId: "cbse-prep", mappingProgress: { scope: { homeBlockId: "nb2" } } },
  b: { filename: "ESoft 7", blockId: "nb2" },
};

describe("bank exam blocks", () => {
  it("marks a bank as another block's exam material without touching other banks", () => {
    const next = withExamBlock(meta, "NB IMCQ 7", "nb3", true);
    expect(markedExamBlockIds(next.a)).toEqual(["nb3"]);
    expect(next.b).toBe(meta.b);
    expect(bankBlockIds(next.a)).toEqual(["cbse-prep", "nb2", "nb3"]);
  });

  it("lists a marked bank in the exam block and keeps it in its filed block", () => {
    const next = withExamBlock(meta, "ESoft 7", "nb3", true);
    expect(listedForBlock(next.b, "nb3")).toBe(true);
    expect(listedForBlock(next.b, "nb2")).toBe(true);
    expect(listedForBlock(next.b, "nb1")).toBe(false);
  });

  it("unmarks, and never marks a bank for its own filed block", () => {
    const marked = withExamBlock(meta, "ESoft 7", "nb3", true);
    expect(markedExamBlockIds(withExamBlock(marked, "ESoft 7", "nb3", false).b)).toEqual([]);
    expect(markedExamBlockIds(withExamBlock(meta, "ESoft 7", "nb2", true).b)).toEqual([]);
  });
});
