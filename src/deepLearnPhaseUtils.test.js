import { describe, it, expect } from "vitest";
import {
  migrateDeepLearnPhase,
  normalizeSectionUnderstood,
  normalizeNumericIndexRecord,
  migrateSavedDeepLearnSessionsMap,
  deepLearnPhaseNumber,
  DL_PHASE_ORDER,
} from "./deepLearnPhaseUtils";

describe("migrateDeepLearnPhase", () => {
  it("maps legacy ids to canonical phases", () => {
    expect(migrateDeepLearnPhase("brainDump")).toBe("prime");
    expect(migrateDeepLearnPhase("patientCase")).toBe("patient");
    expect(migrateDeepLearnPhase("structureFunction")).toBe("gaps");
    expect(migrateDeepLearnPhase("algorithmDraw")).toBe("selftest");
    expect(migrateDeepLearnPhase("readRecall")).toBe("selftest");
    expect(migrateDeepLearnPhase("mcq")).toBe("apply");
  });

  it("passes through canonical ids", () => {
    expect(migrateDeepLearnPhase("teach")).toBe("teach");
    expect(migrateDeepLearnPhase("summary")).toBe("summary");
  });

  it("defaults unknown strings to prime", () => {
    expect(migrateDeepLearnPhase("unknown")).toBe("prime");
    expect(migrateDeepLearnPhase("")).toBe("prime");
    expect(migrateDeepLearnPhase(null)).toBe("prime");
    expect(migrateDeepLearnPhase(undefined)).toBe("prime");
  });
});

describe("normalizeSectionUnderstood", () => {
  it("parses string keys from JSON storage", () => {
    expect(normalizeSectionUnderstood({ 0: true, 1: false, "2": true })).toEqual({
      0: true,
      1: false,
      2: true,
    });
  });
});

describe("normalizeNumericIndexRecord", () => {
  it("coerces values to numbers", () => {
    expect(normalizeNumericIndexRecord({ 0: 2, "1": "3" })).toEqual({ 0: 2, 1: 3 });
  });
});

describe("migrateSavedDeepLearnSessionsMap", () => {
  it("migrates phase on each session entry", () => {
    const out = migrateSavedDeepLearnSessionsMap({
      a: { sessionId: "a", phase: "brainDump" },
      b: { sessionId: "b", phase: "readRecall" },
    });
    expect(out.a.phase).toBe("prime");
    expect(out.b.phase).toBe("selftest");
  });
});

describe("deepLearnPhaseNumber", () => {
  it("orders phases 1–7 including summary", () => {
    expect(deepLearnPhaseNumber("prime")).toBe(1);
    expect(deepLearnPhaseNumber("teach")).toBe(2);
    expect(deepLearnPhaseNumber("patientCase")).toBe(3);
    expect(deepLearnPhaseNumber("summary")).toBe(7);
  });
});

describe("DL_PHASE_ORDER", () => {
  it("ends with summary", () => {
    expect(DL_PHASE_ORDER[DL_PHASE_ORDER.length - 1]).toBe("summary");
  });
});
