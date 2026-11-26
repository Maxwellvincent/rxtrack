import { describe, expect, it } from "vitest";
import { readyGeneratedForLectures } from "./reportTargetPool.js";

const row = (id, data) => ({ id, data: () => data });
const question = { stem: "Which artery?", choices: { A: "MCA", B: "PCA" }, correct: "A", questionId: "gen-1" };

describe("readyGeneratedForLectures", () => {
  it("returns ready, valid pooled questions tagged generated, in batches of 30 lectures", async () => {
    const queries = [];
    const getDocs = async q => { queries.push(q); return { docs: queries.length === 1 ? [
      row("p1", { status: "ready", lectureId: "l1", blockId: "nb2", bucket: "b", question }),
      row("p2", { status: "assigned", lectureId: "l1", blockId: "nb2", bucket: "assigned:b", question }),
      row("p3", { status: "ready", lectureId: "l2", blockId: "nb2", bucket: "b", question: { stem: "", choices: {} } }),
    ] : [] }; };
    const ids = Array.from({ length: 31 }, (_, i) => `l${i}`);
    const out = await readyGeneratedForLectures("u", ids, { db: {}, getDocs, collection: () => ({}), query: (...args) => args, where: (...args) => args });
    expect(queries).toHaveLength(2);
    expect(out).toEqual([expect.objectContaining({ poolId: "p1", poolBucket: "b", lectureId: "l1", sourceBlockId: "nb2", sourceKind: "generated", questionId: "gen-1" })]);
  });

  it("does nothing without lectures", async () => {
    expect(await readyGeneratedForLectures("u", [])).toEqual([]);
  });
});
