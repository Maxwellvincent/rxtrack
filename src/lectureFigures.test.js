import { describe, it, expect, vi } from "vitest";
import {
  selectCandidates,
  batchesOf,
  parseLabelReply,
  mergeLabels,
  labelCandidates,
  readStoredLabels,
  applyStoredLabels,
  MIN_FIGURE_BYTES,
  LABEL_BATCH,
} from "./lectureFigures.js";

/** A stand-in for a picked File: only name/size/arrayBuffer are used. */
function file(name, size, byte = 1) {
  const bytes = new Uint8Array(size).fill(byte);
  return { name, size, type: "image/jpeg", arrayBuffer: async () => bytes.buffer };
}

describe("selectCandidates", () => {
  const md = "Follicles hold colloid.\n\n![](_page_4_Figure_1.jpeg)\n\nC cells make calcitonin.\n\n![](_page_9_Picture_3.jpeg)";

  it("keeps figures the markdown references, in the order it references them", async () => {
    const files = [file("_page_9_Picture_3.jpeg", 90_000, 2), file("_page_4_Figure_1.jpeg", 80_000, 1)];
    const out = await selectCandidates({ files, markdown: md });
    expect(out.map((c) => c.name)).toEqual(["_page_4_Figure_1.jpeg", "_page_9_Picture_3.jpeg"]);
  });

  it("carries the surrounding markdown so an atom can be matched to the figure", async () => {
    const out = await selectCandidates({ files: [file("_page_4_Figure_1.jpeg", 80_000)], markdown: md });
    expect(out[0].context).toContain("colloid");
  });

  it("drops icons and crests by size before they cost a model call", async () => {
    const files = [file("_page_4_Figure_1.jpeg", 900), file("_page_9_Picture_3.jpeg", 80_000, 2)];
    const out = await selectCandidates({ files, markdown: md });
    expect(out.map((c) => c.name)).toEqual(["_page_9_Picture_3.jpeg"]);
  });

  it("drops a repeat of an image already picked — a crest on every slide is one image", async () => {
    const files = [file("_page_4_Figure_1.jpeg", 80_000, 7), file("_page_9_Picture_3.jpeg", 80_000, 7)];
    const out = await selectCandidates({ files, markdown: md });
    expect(out).toHaveLength(1);
  });

  it("ignores a picked file the markdown never references", async () => {
    const files = [file("_page_4_Figure_1.jpeg", 80_000), file("notes.pdf", 80_000, 3)];
    const out = await selectCandidates({ files, markdown: md });
    expect(out.map((c) => c.name)).toEqual(["_page_4_Figure_1.jpeg"]);
  });

  it("returns nothing when the folder has no images", async () => {
    expect(await selectCandidates({ files: [], markdown: md })).toEqual([]);
  });

  it("honours a caller-supplied size floor", async () => {
    const files = [file("_page_4_Figure_1.jpeg", 5_000)];
    expect(await selectCandidates({ files, markdown: md, minBytes: 1_000 })).toHaveLength(1);
    expect(MIN_FIGURE_BYTES).toBeGreaterThan(5_000);
  });
});

describe("batchesOf", () => {
  it("splits into full batches plus the remainder", () => {
    expect(batchesOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("defaults to a batch size the model can keep in order", () => {
    expect(LABEL_BATCH).toBeLessThanOrEqual(6);
  });
});

describe("parseLabelReply", () => {
  it("reads a bare JSON array", () => {
    expect(parseLabelReply('[{"kind":"histology","shows":"thyroid"}]', 1)).toEqual([
      { kind: "histology", shows: "thyroid" },
    ]);
  });

  it("survives a model that wrapped the array in a code fence", () => {
    expect(parseLabelReply('```json\n[{"kind":"diagram","shows":"axis"}]\n```', 1)).toHaveLength(1);
  });

  it("refuses a reply with the wrong number of labels — the mapping would be wrong", () => {
    expect(() => parseLabelReply('[{"kind":"diagram"}]', 3)).toThrow();
  });

  it("refuses a reply that is not JSON at all", () => {
    expect(() => parseLabelReply("I cannot help with that", 1)).toThrow();
  });
});

describe("mergeLabels", () => {
  const cands = [
    { name: "a.jpeg", context: "ctx a", bytes: 1, url: "blob:a" },
    { name: "b.jpeg", context: "ctx b", bytes: 2, url: "blob:b" },
  ];

  it("pairs each label with its candidate by position", () => {
    const out = mergeLabels(cands, [
      { kind: "histology", shows: "follicles" },
      { kind: "decorative", shows: "" },
    ]);
    expect(out[0]).toMatchObject({ name: "a.jpeg", kind: "histology", shows: "follicles", context: "ctx a" });
    expect(out[1].kind).toBe("decorative");
  });

  it("treats an unknown kind as decorative rather than guessing", () => {
    expect(mergeLabels(cands, [{ kind: "photo" }, {}])[0].kind).toBe("decorative");
  });

  it("preselects content and leaves decoration unticked", () => {
    const out = mergeLabels(cands, [{ kind: "clinical" }, { kind: "decorative" }]);
    expect(out[0].keep).toBe(true);
    expect(out[1].keep).toBe(false);
  });
});

describe("stored labels from a bulk run", () => {
  const cands = [{ name: "a.jpeg" }, { name: "b.jpeg" }];
  const manifest = (v) => ({ name: "images.json", text: async () => JSON.stringify(v) });

  it("reads a manifest the bulk script left in the folder", async () => {
    const out = await readStoredLabels([manifest([{ file: "a.jpeg", kind: "histology" }])]);
    expect(out).toHaveLength(1);
  });

  it("reports none when the folder was never pre-labelled", async () => {
    expect(await readStoredLabels([{ name: "a.jpeg" }])).toBe(null);
  });

  it("reports none for an unreadable or empty manifest rather than throwing", async () => {
    expect(await readStoredLabels([{ name: "images.json", text: async () => "{oops" }])).toBe(null);
    expect(await readStoredLabels([manifest([])])).toBe(null);
  });

  it("matches labels by filename, not position", () => {
    const out = applyStoredLabels(cands, [
      { file: "b.jpeg", kind: "clinical", shows: "goitre" },
      { file: "a.jpeg", kind: "diagram", shows: "axis" },
    ]);
    expect(out[0]).toMatchObject({ name: "a.jpeg", kind: "diagram" });
    expect(out[1]).toMatchObject({ name: "b.jpeg", kind: "clinical", shows: "goitre" });
  });

  it("leaves a figure the manifest never covered selectable and unlabelled", () => {
    const out = applyStoredLabels(cands, [{ file: "a.jpeg", kind: "histology" }]);
    expect(out[1]).toMatchObject({ kind: "unlabelled", keep: true });
  });
});

describe("labelCandidates", () => {
  const cands = [
    { name: "a.jpeg", context: "", bytes: 1, mimeType: "image/jpeg", data: "AAA" },
    { name: "b.jpeg", context: "", bytes: 2, mimeType: "image/jpeg", data: "BBB" },
  ];

  it("labels every candidate and reports progress as it goes", async () => {
    const complete = vi.fn(async () => JSON.stringify([{ kind: "histology", shows: "x" }]));
    const onProgress = vi.fn();
    const out = await labelCandidates(cands, { complete, batchSize: 1, onProgress });
    expect(out.map((f) => f.kind)).toEqual(["histology", "histology"]);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2);
  });

  it("keeps the figures when the model is unreachable, just unlabelled", async () => {
    const complete = vi.fn(async () => null);
    const out = await labelCandidates(cands, { complete, batchSize: 2 });
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("unlabelled");
    // Unlabelled is still selectable — the point is to see them, not to trust a model.
    expect(out[0].keep).toBe(true);
  });

  it("does not lose a whole lecture to one bad batch", async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error("bridge 500"))
      .mockResolvedValueOnce(JSON.stringify([{ kind: "diagram", shows: "y" }]));
    const out = await labelCandidates(cands, { complete, batchSize: 1 });
    expect(out.map((f) => f.kind)).toEqual(["unlabelled", "diagram"]);
  });
});
