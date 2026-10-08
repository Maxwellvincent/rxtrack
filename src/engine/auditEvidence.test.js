import { describe, it, expect } from "vitest";
import { numberedAuditEvidence, resolveAuditEvidence } from "./auditEvidence.js";
import { verifyReasoningReview } from "./questionOrder.js";

describe("numbered source evidence", () => {
  const source = "A taught causal relationship connects the upstream and downstream processes.";
  const prompt = numberedAuditEvidence({ lectureText: source }, `[Lecture excerpt 1]\n${source}`);
  it("resolves citations to actual source text without model transcription", () => {
    const result = resolveAuditEvidence({ reviews: [{ reasoning: { evidenceIds: ["E1"] } }] }, prompt);
    expect(result.reviews[0].reasoning.sourceQuotes).toEqual([source]);
  });
  it("rejects unknown IDs even when accompanied by a valid ID or forged quote", () => {
    expect(resolveAuditEvidence({ reviews: [{ reasoning: { evidenceIds: ["E1", "E99"], sourceQuotes: [source] } }] }, prompt).reviews[0].reasoning.sourceQuotes).toEqual([]);
  });
  it("excludes fabricated retrieval text and objective-only statements", () => {
    expect(numberedAuditEvidence({ lectureText: source, objectives: [{ text: source }] }, `[Lecture excerpt 1]\n${source}`)).toContain("[]");
    expect(numberedAuditEvidence({ lectureText: source }, "Invented medical mechanism absent from source.")).toContain("[]");
  });
  it("deduplicates citations and preserves legacy review compatibility", () => {
    expect(resolveAuditEvidence({ reviews: [{ reasoning: { evidenceIds: ["E1", "E1"] } }] }, prompt).reviews[0].reasoning.sourceQuotes).toHaveLength(1);
    const legacy = { reviews: [{ reasoning: { sourceQuotes: [source] } }] };
    expect(resolveAuditEvidence(legacy, prompt)).toEqual(legacy);
  });
  it("still requires connected reasoning after resolving valid evidence", () => {
    const reasoning = { evidenceIds: ["E1"], orderLevel: "second-order", steps: ["Interpret the changed upstream process", "Apply the taught relationship to predict the downstream result"], allStepsRequired: true, connectedChain: true, singleEndpoint: true, choiceShortcut: false };
    const review = resolveAuditEvidence({ reviews: [{ approved: true, reasoning }] }, prompt).reviews[0];
    expect(verifyReasoningReview(review, {}, { lectureText: source })).toBeTruthy();
    expect(verifyReasoningReview({ ...review, reasoning: { ...review.reasoning, choiceShortcut: true } }, {}, { lectureText: source })).toBeNull();
  });
});
