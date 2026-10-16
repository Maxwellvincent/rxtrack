import { expect, it } from "vitest";
import { CBSE_OWNER, CBSE_BLOCK_ID, ensureCbseTerms, buildCbsePool, cbseProgress, selectCbseQuestions } from "./cbsePrep.js";
const terms = [{ id: "t1", name: "Term 1", blocks: [{ id: "b1", name: "Foundations" }] }, { id: "t2", name: "Term 2", blocks: [{ id: "b2", name: "Neuro" }] }];
const q = (stem, extra = {}) => ({ stem, choices: { A: "Key", B: "Distractor" }, correct: "A", ...extra });
const banks = { "ExamSoft.pdf": [q("A foundation concept")], "Homework.pdf": [q("A neural concept", { sourceSection: "NB 05", sourceSectionTitle: "Neurons and Glia" })] };
const meta = { one: { filename: "ExamSoft.pdf", blockId: "b1", sourceKind: "examsoft" }, two: { filename: "Homework.pdf", blockId: "b2", sourceKind: "homework" } };
const lectures = [{ id: "l5", blockId: "b2", lectureNumber: 5, lectureTitle: "NB 05 Neurons and Glia" }];
it("adds the personal CBSE block once without changing existing terms or another account", () => {
  const next = ensureCbseTerms(terms, CBSE_OWNER);
  expect(next.slice(0,2)).toEqual(terms);
  expect(next[2].blocks[0]).toMatchObject({ id: CBSE_BLOCK_ID, examDate: "2026-12-09", examWindowEnd: "2026-12-10" });
  expect(ensureCbseTerms(next, CBSE_OWNER)).toBe(next);
  expect(ensureCbseTerms(terms, "other-account")).toBe(terms);
});
it("consolidates exact school duplicates, excludes incomplete figures and preserves source blocks", () => {
  const pool = buildCbsePool({ ...banks, "Copy.pdf": [q("A foundation concept"), q("An image question", { hasImage: true })] }, meta, lectures, terms);
  expect(pool.questions).toHaveLength(2); expect(pool.duplicates).toBe(1); expect(pool.excluded).toBe(1);
  expect(pool.questions[1]).toMatchObject({ sourceBlockId: "b2", sourceTermName: "Term 2", lectureId: "l5", objectiveIds: [] });
});
it("counts all-term answered evidence once, keeps report scores separate and leaves unlinked objectives uncredited", () => {
  const pool = buildCbsePool(banks, meta, lectures, terms).questions;
  const session = { sessionId: "s", status: "submitted", submittedAt: 100, blockId: CBSE_BLOCK_ID, questions: pool, answers: [{ questionId: pool[1].questionId, value: "B" }] };
  const report = { id: "r", concept: "Neuro", reportScore: 30, reportSampleSize: 10, masteryLevel: "struggling", tags: ["exam-report"] };
  const progress = cbseProgress({ sessions: [session, session], lectures, weakConcepts: { b2: [report] }, objectives: { b2: [{ id: "o", objective: "Describe neurons" }] }, calibration: { b1: [{ ts: 1, concept: "ATP", correct: true }, { ts: 1, concept: "ATP", correct: true }] } });
  expect(progress.answered).toBe(2); expect(progress.correct).toBe(1); expect(progress.reports[0].reportScore).toBe(30);
  expect(progress.concepts.find(row => row.label === "Neurons and Glia").blockId).toBe("b2");
  expect(progress.objectives[0].attempts).toBe(0); expect(progress.unlinked).toBe(2);
});
it("selects mixed terms faithfully and never silently creates a shorter exam", () => {
  const pool = buildCbsePool(banks, meta, lectures, terms).questions;
  const progress = cbseProgress();
  expect(selectCbseQuestions(pool, progress, { count: 2, random: () => .5 }).questions.map(q => q.sourceBlockId)).toEqual(["b1","b2"]);
  expect(selectCbseQuestions(pool, progress, { count: 3 }).error).toMatch(/Only 2/);
  expect(selectCbseQuestions(pool, progress, { count: 2, source: "examsoft" }).error).toMatch(/Only 1/);
});
it("weak and unseen practice use previous answer outcomes across blocks", () => {
  const pool = buildCbsePool(banks, meta, lectures, terms).questions;
  const session = { sessionId: "s", status: "submitted", questions: pool, answers: [{ questionId: pool[0].questionId, value: "B" }] };
  const progress = cbseProgress({ sessions: [session] });
  expect(selectCbseQuestions(pool, progress, { count: 1, mode: "weak" }).questions[0].sourceBlockId).toBe("b1");
  expect(selectCbseQuestions(pool, progress, { count: 1, mode: "unseen" }).questions[0].sourceBlockId).toBe("b2");
});
