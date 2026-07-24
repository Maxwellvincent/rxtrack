import { describe, it, expect } from "vitest";
import { mergeScheduleIntoStores } from "./mergeSchedule.js";

// Deterministic id generator for assertions.
const idgen = () => { idgen.n = (idgen.n || 0) + 1; return "id" + idgen.n; };

const blocks = [
  { system: "ER", name: "Endocrine & Reproductive", startDate: "2026-08-12", examDate: "2026-08-31",
    lectures: [{ number: 1, date: "2026-08-12" }, { number: 2, date: "2026-08-12" }] },
  { system: "DM", name: "Diabetes & Metabolism", startDate: "2026-09-01", examDate: "2026-09-30",
    lectures: [{ number: 1, date: "2026-09-01" }] },
];

describe("mergeScheduleIntoStores", () => {
  const existing = {
    terms: [{ id: "t2", name: "Term 2", color: "#123", blocks: [{ id: "erb", name: "Endocrine & Reproductive", status: "active" }] }],
    examDates: {},
    lectures: [{ id: "keepme", blockId: "erb", lectureType: "LEC", lectureNumber: 1, filename: "already.pdf" }],
  };

  it("reuses the existing block by name (no duplicate) and sets its startDate", () => {
    idgen.n = 0;
    const r = mergeScheduleIntoStores(blocks, existing, { termName: "Term 2", idgen });
    const t2 = r.terms.find((t) => t.id === "t2");
    const er = t2.blocks.filter((b) => b.name === "Endocrine & Reproductive");
    expect(er).toHaveLength(1);
    expect(er[0].id).toBe("erb");
    expect(er[0].startDate).toBe("2026-08-12");
  });

  it("creates the DM block under the same term", () => {
    idgen.n = 0;
    const r = mergeScheduleIntoStores(blocks, existing, { termName: "Term 2", idgen });
    const dm = r.terms.find((t) => t.id === "t2").blocks.find((b) => b.name === "Diabetes & Metabolism");
    expect(dm).toBeTruthy();
    expect(dm.startDate).toBe("2026-09-01");
  });

  it("sets exam dates keyed by resolved block id", () => {
    idgen.n = 0;
    const r = mergeScheduleIntoStores(blocks, existing, { termName: "Term 2", idgen });
    const dmId = r.terms.find((t) => t.id === "t2").blocks.find((b) => b.name === "Diabetes & Metabolism").id;
    expect(r.examDates.erb).toBe("2026-08-31");
    expect(r.examDates[dmId]).toBe("2026-09-30");
  });

  it("stubs new lectures but never clobbers an existing lecture (same block+number)", () => {
    idgen.n = 0;
    const r = mergeScheduleIntoStores(blocks, existing, { termName: "Term 2", idgen });
    const erLecs = r.lectures.filter((l) => l.blockId === "erb");
    expect(erLecs.find((l) => l.id === "keepme")).toBeTruthy();          // preserved
    expect(erLecs.filter((l) => l.lectureNumber === 1)).toHaveLength(1); // not duplicated
    expect(erLecs.find((l) => l.lectureNumber === 2)).toBeTruthy();      // added
  });

  it("never emits an undefined termId (Firestore rejects undefined) and backfills existing lectures", () => {
    idgen.n = 0;
    const r = mergeScheduleIntoStores(blocks, existing, { termName: "Term 2", idgen });
    expect(r.lectures.every((l) => l.termId !== undefined)).toBe(true);
    // the pre-existing ER lecture had no termId → backfilled to the term id
    expect(r.lectures.find((l) => l.id === "keepme").termId).toBe("t2");
  });

  it("reports a summary of what changed", () => {
    idgen.n = 0;
    const r = mergeScheduleIntoStores(blocks, existing, { termName: "Term 2", idgen });
    expect(r.summary).toMatchObject({ blocksAdded: 1, blocksUpdated: 1, examDatesSet: 2, lecturesAdded: 2 });
  });

  it("creates the term when it does not exist", () => {
    idgen.n = 0;
    const r = mergeScheduleIntoStores(blocks, { terms: [], examDates: {}, lectures: [] }, { termName: "Term 2", idgen });
    const t = r.terms.find((x) => x.name === "Term 2");
    expect(t).toBeTruthy();
    expect(t.blocks).toHaveLength(2);
  });
});
