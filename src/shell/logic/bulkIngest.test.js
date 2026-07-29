import { describe, expect, it, vi } from "vitest";
import {
  planBulkImport,
  summarizePlan,
  toLocalRow,
  runQueue,
} from "./bulkIngest.js";

const f = (name) => ({ name });

describe("planBulkImport", () => {
  const existing = [
    { id: "old-3", blockId: "b1", lectureType: "LEC", lectureNumber: 3, lectureTitle: "Thyroid" },
    { id: "other-block", blockId: "b2", lectureType: "LEC", lectureNumber: 4, lectureTitle: "Adrenal" },
  ];

  it("marks each file as filling an existing lecture or adding a new one", () => {
    const plan = planBulkImport(
      [f("Lecture 03 - Thyroid.md"), f("Lecture 04 - Adrenal.md")],
      existing,
      "b1"
    );

    expect(plan.map((p) => [p.lectureNumber, p.action])).toEqual([
      [3, "fill"],
      [4, "add"],
    ]);
    expect(plan[0].fillsId).toBe("old-3");
    // Same slot number in another block is a different lecture.
    expect(plan[1].fillsId).toBeNull();
  });

  it("fills the untitled, dated stubs that schedule import creates", () => {
    const stubs = [
      { id: "s2", blockId: "b1", lectureType: "LEC", lectureNumber: 2, filename: "ER LEC 02", lectureDate: "2026-08-12", chunks: [] },
    ];
    const plan = planBulkImport([f("Lecture 02 - Hypothalamus.md")], stubs, "b1");

    expect(plan[0]).toMatchObject({ action: "fill", fillsId: "s2", fillsDate: "2026-08-12" });
  });

  it("orders by lecture number, un-numbered last", () => {
    const plan = planBulkImport(
      [f("Lecture 10 - Ten.md"), f("Overview.md"), f("Lecture 02 - Two.md")],
      [],
      "b1"
    );
    expect(plan.map((p) => p.lectureTitle)).toEqual(["Two", "Ten", "Overview"]);
  });

  it("collapses a file picked twice", () => {
    const plan = planBulkImport([f("Lecture 01 - A.md"), f("lecture 01 - a.md")], [], "b1");
    expect(plan).toHaveLength(1);
  });

  it("survives an empty or nameless selection", () => {
    expect(planBulkImport([], [], "b1")).toEqual([]);
    expect(planBulkImport([{ name: "" }], [], "b1")).toEqual([]);
    expect(planBulkImport(null, null, "b1")).toEqual([]);
  });
});

describe("summarizePlan", () => {
  it("counts adds, fills, and how many carry a scheduled date", () => {
    const plan = [
      { action: "add" },
      { action: "fill", fillsDate: "2026-08-12" },
      { action: "fill", fillsDate: null },
    ];
    expect(summarizePlan(plan)).toEqual({ total: 3, add: 1, fill: 2, dated: 1 });
    expect(summarizePlan([])).toEqual({ total: 0, add: 0, fill: 0, dated: 0 });
  });
});

describe("toLocalRow", () => {
  it("drops the text and keeps everything else", () => {
    const row = toLocalRow({
      id: "l1",
      lectureTitle: "Thyroid",
      chunks: [{ markdown: "a".repeat(5000) }],
      fullText: "b".repeat(5000),
      lectureDate: "2026-09-01",
    });

    expect(row).toEqual({ id: "l1", lectureTitle: "Thyroid", lectureDate: "2026-09-01", chunks: [] });
    // Empty rather than absent: the sync reads a missing chunks field as
    // "leave the cloud copy alone", which is what we want here.
    expect(row.chunks).toEqual([]);
    expect(row.fullText).toBeUndefined();
  });
});

describe("runQueue", () => {
  it("processes every item and reports progress", async () => {
    const seen = [];
    const onProgress = vi.fn();
    const results = await runQueue([1, 2, 3, 4, 5], async (n) => { seen.push(n); return n * 2; }, {
      concurrency: 2,
      onProgress,
    });

    expect(results).toHaveLength(5);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(onProgress).toHaveBeenCalledTimes(5);
  });

  it("keeps going when one item throws, and records which", async () => {
    const results = await runQueue([1, 2, 3], async (n) => {
      if (n === 2) throw new Error("bad deck");
      return n;
    }, { concurrency: 1 });

    expect(results.filter((r) => r.ok)).toHaveLength(2);
    const failed = results.find((r) => !r.ok);
    expect(failed).toMatchObject({ item: 2, error: "bad deck" });
  });

  it("never runs more than the concurrency limit at once", async () => {
    let live = 0;
    let peak = 0;
    await runQueue([1, 2, 3, 4, 5, 6], async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
    }, { concurrency: 2 });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("does nothing gracefully for an empty queue", async () => {
    expect(await runQueue([], async () => 1)).toEqual([]);
  });
});
