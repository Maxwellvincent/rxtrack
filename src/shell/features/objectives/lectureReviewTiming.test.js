import { expect, it } from "vitest";
import { lectureReviewTiming } from "./lectureReviewTiming.js";
import { localDateString } from "../../logic/completionLog.js";
const now = new Date(2026, 9, 21, 12).getTime();
const yesterday = new Date(2026, 9, 20, 12).getTime();
const row = {lec: {id: "l"}, total: 10, m: 0, st: 0};
it("uses the latest question review date and existing spacing for developing objectives", () => {
 expect(lectureReviewTiming(row, "NB", {}, {evidenceJournal: [{lectureId: "l", blockId: "NB", at: yesterday}]}, null, now)).toEqual({lastReviewedAt: yesterday, nextReview: "2026-10-21", status: "due"});
 const today = lectureReviewTiming(row, "NB", {}, {evidenceJournal: [{lectureId: "l", at: now}]}, null, now);
 expect(today).toMatchObject({nextReview: "2026-10-22", status: "upcoming"});
});
it("preserves an overdue stored review date instead of silently skipping it", () => {
 const completion = {l__NB: {lastActivityDate: "2026-10-18", reviewDates: ["2026-10-19", "2026-10-24"], activityLog: [{activityType: "review", date: "2026-10-18"}]}};
 expect(lectureReviewTiming(row, "NB", completion, {}, null, now)).toMatchObject({nextReview: "2026-10-19", status: "due"});
});
it("new question practice supersedes a stale completion schedule without rewriting history", () => {
 const completion = {l__NB: {lastActivityDate: "2026-10-18", reviewDates: ["2026-10-19"], activityLog: [{activityType: "review", date: "2026-10-18"}]}};
 expect(lectureReviewTiming(row, "NB", completion, {evidenceJournal: [{lectureId: "l", at: now}]}, null, now)).toMatchObject({nextReview: "2026-10-22", status: "upcoming"});
 expect(completion.l__NB.reviewDates).toEqual(["2026-10-19"]);
});
it("uses merged lecture history and ignores other block events or missing dates", () => {
 expect(lectureReviewTiming({...row, lec: {id: "l", mergedFrom: [{id: "old"}]}}, "NB", {}, {evidenceJournal: [{lectureId: "old", at: yesterday}, {lectureId: "l", blockId: "DM", at: now}]}, null, now).lastReviewedAt).toBe(yesterday);
 expect(lectureReviewTiming(row, "NB", {}, {}, null, now)).toEqual({lastReviewedAt: null, nextReview: null, status: "unknown"});
});
it("prioritizes consolidation today for weak objectives and spaces fully mastered lectures", () => {
 const evidence = {lectures: {l: {lastSeen: now}}};
 expect(lectureReviewTiming({...row, st: 2}, "NB", {}, evidence, null, now)).toMatchObject({nextReview: localDateString(now), status: "due"});
 expect(lectureReviewTiming({...row, m: 10}, "NB", {}, evidence, null, now)).toMatchObject({nextReview: "2026-10-23", status: "upcoming"});
});
