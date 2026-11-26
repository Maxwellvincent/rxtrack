import { describe, expect, it } from "vitest";
import { crossLecturePartners, crossLectureCount, combinedLectureText, crossLectureFocusNotes, verifiedCrossLectureQuotes, partnerSignals, validatedPartnerObjectiveId } from "./crossLecture.js";

const lecture = (id, weekNumber, lectureNumber) => ({ id, weekNumber, lectureNumber, lectureTitle: `Lecture ${lectureNumber}` });

describe("crossLecturePartners", () => {
  it("pairs each lecture with a neighbour from the same week", () => {
    const byId = Object.fromEntries([lecture("a", 9, 40), lecture("b", 9, 41), lecture("c", 10, 45), lecture("d", 10, 46)].map(l => [l.id, l]));
    const partners = crossLecturePartners(["a", "b", "c", "d"], byId);
    expect(partners.get("a")).toBe("b");
    expect(partners.get("b")).toBe("a");
    expect(partners.get("c")).toBe("d");
    expect(partners.get("d")).toBe("c");
  });

  it("falls back to the nearest lecture when a week has only one", () => {
    const byId = Object.fromEntries([lecture("a", 9, 40), lecture("b", 9, 41), lecture("c", 10, 45)].map(l => [l.id, l]));
    expect(crossLecturePartners(["a", "b", "c"], byId).get("c")).toBe("b");
  });

  it("uses the Monday–Friday week of the lecture date when no week number is stored", () => {
    const dated = (id, lectureDate, lectureNumber) => ({ id, lectureDate, lectureNumber });
    const byId = Object.fromEntries([dated("a", "2026-11-16", 1), dated("b", "2026-11-20", 2), dated("c", "2026-11-23", 3), dated("d", "2026-11-24", 4)].map(l => [l.id, l]));
    const partners = crossLecturePartners(["a", "b", "c", "d"], byId);
    expect(partners.get("b")).toBe("a");
    expect(partners.get("c")).toBe("d");
  });

  it("returns no partners for a single-lecture set", () => {
    expect(crossLecturePartners(["a"], { a: lecture("a", 9, 40) }).size).toBe(0);
  });
});

describe("crossLectureCount", () => {
  it("reserves about a quarter of a lecture's slots, never all of them", () => {
    expect(crossLectureCount(8)).toBe(2);
    expect(crossLectureCount(4)).toBe(1);
    expect(crossLectureCount(2)).toBe(0);
    expect(crossLectureCount(0)).toBe(0);
  });
});

describe("combinedLectureText and focus notes", () => {
  it("labels the partner lecture so reviewers can tell the sources apart", () => {
    const text = combinedLectureText("Primary rule text.", { title: "NB 46 Cerebellum", text: "Partner rule text." });
    expect(text).toContain("Primary rule text.");
    expect(text).toMatch(/PARTNER LECTURE — NB 46 Cerebellum/);
    expect(text).toContain("Partner rule text.");
  });

  it("requires one quoted rule from each lecture", () => {
    const notes = crossLectureFocusNotes("NB 45 Brainstem", "NB 46 Cerebellum");
    expect(notes).toMatch(/NB 45 Brainstem/);
    expect(notes).toMatch(/NB 46 Cerebellum/);
    expect(notes).toMatch(/one exact quote from each lecture/i);
  });
});

describe("verifiedCrossLectureQuotes", () => {
  const primary = "The medial lemniscus carries touch and vibration from the contralateral body.";
  const partner = "The anterior spinal artery supplies the medial medulla including the pyramid.";

  it("accepts a reviewed item whose quotes come from both lectures", () => {
    const question = { reasoningAudit: { sourceQuotes: ["The anterior spinal artery supplies the medial medulla"] },
      qualityAudit: { blindSolve: { sourceQuotes: ["medial lemniscus carries touch and vibration"] } } };
    expect(verifiedCrossLectureQuotes(question, primary, partner)).toBe(true);
  });

  it("rejects an item grounded in only one lecture", () => {
    const question = { reasoningAudit: { sourceQuotes: ["medial lemniscus carries touch and vibration"] }, questionPlan: { sourceQuotes: ["The medial lemniscus carries touch"] } };
    expect(verifiedCrossLectureQuotes(question, primary, partner)).toBe(false);
  });

  it("ignores writer-plan quotes when no reviewed quote supports the partner lecture", () => {
    const question = { reasoningAudit: { sourceQuotes: ["medial lemniscus carries touch and vibration"] },
      questionPlan: { sourceQuotes: ["The anterior spinal artery supplies the medial medulla"] } };
    expect(verifiedCrossLectureQuotes(question, primary, partner)).toBe(false);
  });

  it("ignores very short quotes that could match by accident", () => {
    const question = { reasoningAudit: { sourceQuotes: ["the medial", "medial lemniscus carries touch and vibration"] } };
    expect(verifiedCrossLectureQuotes(question, primary, partner)).toBe(false);
  });
});

describe("partner choice", () => {
  const byId = Object.fromEntries([lecture("a", 9, 40), lecture("b", 9, 41), lecture("c", 9, 42), lecture("d", 10, 45)].map(l => [l.id, l]));

  it("prefers a same-week lecture the school already tests together, then shared terms, then weak objectives", () => {
    const signals = partnerSignals({
      schoolQuestions: [{ lectureId: "c", secondaryLectureIds: ["a"] }],
      termIndex: { pyramid: { lectureIds: ["a", "b"] }, lemniscus: { lectureIds: ["a", "b"] } },
      objectivesByLecture: { b: [{ id: "ob" }], c: [{ id: "oc" }] },
      evidenceObjectives: { ob: { attempts: 5, correct: 5 } },
    });
    expect(crossLecturePartners(["a", "b", "c", "d"], byId, { signals }).get("a")).toBe("c");
    expect(crossLecturePartners(["a", "b", "c", "d"], byId, { signals }).get("b")).toBe("a");
  });

  it("keeps IMCQ partners inside the week but lets ESoft reach across the span", () => {
    const signals = partnerSignals({ schoolQuestions: [{ lectureId: "d", secondaryLectureIds: ["a"] }] });
    expect(crossLecturePartners(["d"], byId, { candidateIds: ["a", "b", "c"], signals }).get("d")).toBe("c");
    expect(crossLecturePartners(["d"], byId, { candidateIds: ["a", "b", "c"], window: "scope", signals }).get("d")).toBe("a");
  });

  it("ignores block-wide terms as links", () => {
    const signals = partnerSignals({ termIndex: { neuron: { lectureIds: ["a", "b", "c", "d", "e", "f", "g"] } } });
    expect(signals.sharedTerms.size).toBe(0);
  });

  it("credits a partner objective only when the claimed id is one of the partner's", () => {
    const partnerObjectives = [{ id: "o46", code: "SOM.NB.0546" }];
    expect(validatedPartnerObjectiveId({ questionPlan: { partnerObjectiveId: "o46" } }, partnerObjectives)).toBe("o46");
    expect(validatedPartnerObjectiveId({ questionPlan: { partnerObjectiveId: "SOM.NB.0546" } }, partnerObjectives)).toBe("o46");
    expect(validatedPartnerObjectiveId({ questionPlan: { partnerObjectiveId: "o99" } }, partnerObjectives)).toBe(null);
    expect(crossLectureFocusNotes("A", "B", partnerObjectives)).toContain('"id":"o46"');
  });
});
