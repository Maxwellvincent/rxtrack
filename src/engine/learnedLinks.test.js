import { describe, expect, it } from "vitest";
import { headingKey, learnedHeadingMap, applyLearnedHeadings, similarPrecedents } from "./learnedLinks.js";

const mine = (id, heading, lectureId, extra = {}) => ({ id, stem: `Question ${id}`, correct: "A", choices: { A: "x" }, sourceSectionTitle: heading, lectureId, lectureLabel: `L ${lectureId}`, lectureLinkBasis: "user-assigned", curriculumLinkStatus: "user-lecture-only", objectiveIds: [], ...extra });
const open = (id, heading, extra = {}) => ({ id, stem: `Question ${id}`, correct: "A", choices: { A: "x" }, sourceSectionTitle: heading, ...extra });

describe("headingKey", () => {
  it("normalizes punctuation, case and leading lecture numbers", () => {
    expect(headingKey({ sourceSectionTitle: "Dissociative Disorders" })).toBe(headingKey({ sourceSectionTitle: "  dissociative   disorders:" }));
    expect(headingKey({ sourceSection: "NB 58", sourceSectionTitle: "Trauma and Stressor-Related Disorders" })).toBe("trauma and stressor related disorders");
    expect(headingKey({})).toBe("");
  });
});

describe("learnedHeadingMap", () => {
  it("learns a heading from your assignments only when they agree", () => {
    const map = learnedHeadingMap([mine("1", "Dissociative Disorders", "nb58"), mine("2", "Dissociative Disorders", "nb58"),
      mine("3", "Sleep", "nb61"), mine("4", "Sleep", "nb62"), open("5", "Dissociative Disorders")]);
    expect(map.get("dissociative disorders")).toMatchObject({ lectureId: "nb58", count: 2 });
    expect(map.has("sleep")).toBe(false); // conflicting assignments teach nothing
  });

  it("ignores automatic links so the system only learns from you", () => {
    const auto = open("1", "Language/Aphasia", { lectureId: "nb73", lectureLinkBasis: "two-pass-source-verified", curriculumLinkStatus: "evidence-verified" });
    expect(learnedHeadingMap([auto]).size).toBe(0);
  });
});

describe("applyLearnedHeadings", () => {
  it("pins unlinked questions under a learned heading and leaves everything else alone", () => {
    const questions = [mine("1", "Dissociative Disorders", "nb58"), open("2", "Dissociative Disorders"), open("3", "Sleep"),
      open("4", "Dissociative Disorders", { lectureId: "nb59", curriculumLinkStatus: "evidence-verified", objectiveIds: ["o"] })];
    const { questions: next, applied } = applyLearnedHeadings(questions, learnedHeadingMap(questions));
    expect(applied).toBe(1);
    expect(next[1]).toMatchObject({ lectureId: "nb58", lectureLinkBasis: "learned-heading", curriculumLinkStatus: "user-lecture-only", objectiveIds: [] });
    expect(next[2]).toEqual(questions[2]);
    expect(next[3]).toEqual(questions[3]);
  });
});

describe("similarPrecedents", () => {
  it("returns your most similar confirmed questions, same heading first", () => {
    const confirmed = [
      mine("a", "Sleep", "nb61", { stem: "Polysomnography shows sleep spindles and K complexes. Which stage?", curriculumLinkStatus: "user-confirmed", objectiveIds: ["o61"] }),
      mine("b", "Anxiety", "nb56", { stem: "A woman has six months of excessive worry. Diagnosis?", curriculumLinkStatus: "user-confirmed", objectiveIds: ["o56"] }),
      mine("c", "Sleep", "nb62", { stem: "Lecture-only pin without objectives", curriculumLinkStatus: "user-lecture-only" }),
    ];
    const question = open("q", "Sleep", { stem: "An EEG shows sleep spindles and K complexes during the night. Which sleep stage?" });
    const result = similarPrecedents(question, confirmed, 2);
    expect(result.map(p => p.lectureId)).toEqual(["nb61"]);
    expect(result[0]).toMatchObject({ objectiveIds: ["o61"], sameHeading: true });
  });
});
