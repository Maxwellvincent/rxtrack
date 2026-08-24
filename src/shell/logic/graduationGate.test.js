import { describe, expect, it } from "vitest";
import { resolveObjectiveTarget } from "./graduationGate.js";

const atoms = [
  { term: "Thyroglobulin", objectiveIds: ["obj1"] },
  { term: "Pendrin", objectiveIds: ["obj1"] },
  { term: "TSH receptor", objectiveIds: ["obj2"] },
];

// Far enough from any exam to land in the "Full" gate (≥21 days): needs 3 sessions, last two
// ≥7 days apart, score ≥80 and avgConfidence ≥0.6 — the strictest tier, so a passing case here
// exercises every gate on the way.
const FAR_EXAM = "2099-01-01";

describe("resolveObjectiveTarget", () => {
  it("scores this objective off its OWN atoms, not the lecture-wide session score", () => {
    const masterySummary = (keys) => {
      // obj1's atoms (thyroglobulin, pendrin) both complete; obj2's (tsh receptor) is not —
      // fed via the same injected fn, keyed by whichever atomKeys resolveObjectiveTarget asks for.
      const allComplete = keys.every((k) => ["thyroglobulin", "pendrin"].includes(k));
      return { masteredCount: allComplete ? keys.length : 0, totalCount: keys.length };
    };
    const sessions = [
      { score: 40, avgConfidence: 0.5, hasLandmines: false, at: "2026-01-01" },
      { score: 40, avgConfidence: 0.5, hasLandmines: false, at: "2025-12-20" },
      { score: 40, avgConfidence: 0.5, hasLandmines: false, at: "2025-12-01" },
    ];
    const obj1Target = resolveObjectiveTarget({
      objective: { id: "obj1", status: "developing" },
      atoms,
      sessions,
      avgConfidence: 0.7,
      hasLandmines: false,
      blockExamDate: FAR_EXAM,
      masterySummary,
      now: new Date("2026-01-02"),
    });
    const obj2Target = resolveObjectiveTarget({
      objective: { id: "obj2", status: "developing" },
      atoms,
      sessions,
      avgConfidence: 0.7,
      hasLandmines: false,
      blockExamDate: FAR_EXAM,
      masterySummary,
      now: new Date("2026-01-02"),
    });
    // obj1's own atoms are 100% complete (score 100, well above the 80 bar) — mastered despite
    // the lecture-wide session score sitting at 40.
    expect(obj1Target).toBe("mastered");
    // obj2's atom is not complete (score 0, below the <60 floor) — flagged struggling even
    // though it's the SAME sessions array, same cadence, same day as obj1's mastered result.
    expect(obj2Target).toBe("struggling");
  });

  it("keeps the real session count and gaps for cadence gates — only the threshold score is substituted", () => {
    const masterySummary = () => ({ masteredCount: 2, totalCount: 2 }); // 100%
    const base = { avgConfidence: 0.8, hasLandmines: false, blockExamDate: FAR_EXAM, masterySummary, now: new Date("2026-01-02") };

    // Only 1 real session on record — the Full gate needs 3, so this must NOT master even
    // though the atom score is 100 — cadence still comes from the real array.
    const withOneSession = resolveObjectiveTarget({
      objective: { id: "obj1", status: "developing" },
      atoms,
      sessions: [{ score: 10, avgConfidence: 0.1, hasLandmines: false, at: "2026-01-01" }],
      ...base,
    });
    expect(withOneSession).toBe("developing");

    // 3 real sessions, last two ≥7 days apart — cadence satisfied, and the substituted score
    // (100, from atom mastery) clears the threshold.
    const withThreeSessions = resolveObjectiveTarget({
      objective: { id: "obj1", status: "developing" },
      atoms,
      sessions: [
        { score: 10, avgConfidence: 0.1, hasLandmines: false, at: "2026-01-01" },
        { score: 10, avgConfidence: 0.1, hasLandmines: false, at: "2025-12-20" },
        { score: 10, avgConfidence: 0.1, hasLandmines: false, at: "2025-12-01" },
      ],
      ...base,
    });
    expect(withThreeSessions).toBe("mastered");
  });

  it("falls back to the lecture-wide session score when the objective has no atoms tagged yet", () => {
    const masterySummary = () => ({ masteredCount: 0, totalCount: 0 });
    const target = resolveObjectiveTarget({
      objective: { id: "untagged-obj", status: "developing" },
      atoms, // none reference "untagged-obj"
      sessions: [
        { score: 90, avgConfidence: 0.8, hasLandmines: false, at: "2026-01-01" },
        { score: 90, avgConfidence: 0.8, hasLandmines: false, at: "2025-12-20" },
        { score: 90, avgConfidence: 0.8, hasLandmines: false, at: "2025-12-01" },
      ],
      avgConfidence: 0.8,
      hasLandmines: false,
      blockExamDate: FAR_EXAM,
      masterySummary,
      now: new Date("2026-01-02"),
    });
    // Untouched lecture-wide score (90) clears the bar — same as the pre-unification behavior.
    expect(target).toBe("mastered");
  });

  it("never calls masterySummary for an objective with no linked atoms", () => {
    let called = false;
    resolveObjectiveTarget({
      objective: { id: "untagged", status: "untested" },
      atoms,
      sessions: [{ score: 50, avgConfidence: 0.5, hasLandmines: false, at: "2026-01-01" }],
      avgConfidence: 0.5,
      hasLandmines: false,
      masterySummary: () => { called = true; return { masteredCount: 0, totalCount: 0 }; },
    });
    expect(called).toBe(false);
  });

  it("returns null (no change) when there are no sessions at all", () => {
    const target = resolveObjectiveTarget({
      objective: { id: "obj1", status: "untested" },
      atoms,
      sessions: [],
      masterySummary: () => ({ masteredCount: 2, totalCount: 2 }),
    });
    expect(target).toBeNull();
  });
});
