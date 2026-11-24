import { describe, expect, it } from "vitest";
import { crossLecturePartners, crossLectureCount, combinedLectureText, crossLectureFocusNotes, verifiedCrossLectureQuotes } from "./crossLecture.js";

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
